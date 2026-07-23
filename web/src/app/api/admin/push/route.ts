import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { normalizeAdminDashboardUrl } from '@/lib/admin-chat-url';
import { sendWebPush } from '@/lib/web-push';
import { logger } from '@/lib/logger';

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const normalizeToken = (value?: string | null) =>
  (value ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\\n/g, '')
    .replace(/\r?\n/g, '')
    .trim();
const ADMIN_CHAT_ID = 'admin';
const sanitizePhoneDigits = (value?: string | null) => String(value ?? '').replace(/[^0-9]/g, '');
type AdminPushSubscriptionRole = 'admin' | 'manager';
type ConcreteTargetRoleResult =
  | { ok: true; role: AdminPushSubscriptionRole }
  | { ok: false; reason: 'lookup_failed' | 'not_allowed' };

const normalizeAdminNotificationTargetId = (value?: string | null) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === ADMIN_CHAT_ID) return '';
  return sanitizePhoneDigits(raw);
};

async function fetchSharedAdminResidentIds(): Promise<
  { ok: true; residentIds: string[] } | { ok: false }
> {
  const { data, error } = await adminClient
    .from('admin_accounts')
    .select('phone,staff_type')
    .eq('active', true);

  if (error) {
    logger.error('[admin/push] shared admin account query failed', {
      reason: 'account_lookup_failed',
    });
    return { ok: false };
  }

  return {
    ok: true,
    residentIds: Array.from(
      new Set(
        (data ?? [])
          .filter((account) => account.staff_type !== 'developer')
          .map((account) => sanitizePhoneDigits(account.phone))
          .filter((phone) => phone.length > 0),
      ),
    ),
  };
}

async function resolveConcreteTargetRole(
  normalizedTargetId: string,
): Promise<ConcreteTargetRoleResult> {
  const [adminsResult, managersResult] = await Promise.all([
    adminClient
      .from('admin_accounts')
      .select('phone')
      .eq('active', true),
    adminClient
      .from('manager_accounts')
      .select('phone')
      .eq('active', true),
  ]);

  if (adminsResult.error || managersResult.error) {
    logger.error('[admin/push] concrete target account query failed', {
      reason: 'account_lookup_failed',
    });
    return { ok: false, reason: 'lookup_failed' };
  }

  const matchingRoles: AdminPushSubscriptionRole[] = [];
  if ((adminsResult.data ?? []).some((account) => sanitizePhoneDigits(account.phone) === normalizedTargetId)) {
    matchingRoles.push('admin');
  }
  if ((managersResult.data ?? []).some((account) => sanitizePhoneDigits(account.phone) === normalizedTargetId)) {
    matchingRoles.push('manager');
  }

  // An ambiguous cross-role identity is rejected instead of delivering to both
  // subscription roles for the same phone number.
  return matchingRoles.length === 1
    ? { ok: true, role: matchingRoles[0] }
    : { ok: false, reason: 'not_allowed' };
}

/**
 * Protected admin web push endpoint.
 * Called by the fc-notify Edge Function to send web push to all admin browser subscribers.
 *
 * Security: Validated via one of:
 * 1) X-Admin-Push-Secret header
 * 2) Authorization Bearer service-role key (Edge Function to Next.js internal callback)
 */
export async function POST(req: Request) {
  const secret = normalizeToken(req.headers.get('X-Admin-Push-Secret'));
  const expectedSecret = normalizeToken(process.env.ADMIN_PUSH_SECRET);
  const serviceRoleKey = normalizeToken(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const authHeader = req.headers.get('Authorization') ?? '';
  const apikey = normalizeToken(req.headers.get('apikey'));
  const bearer = authHeader.startsWith('Bearer ') ? normalizeToken(authHeader.slice(7)) : '';

  const secretAuthOk = Boolean(expectedSecret && secret && secret === expectedSecret);
  const serviceRoleAuthOk = Boolean(serviceRoleKey && bearer && bearer === serviceRoleKey);
  const apikeyAuthOk = Boolean(serviceRoleKey && apikey && apikey === serviceRoleKey);

  if (!secretAuthOk && !serviceRoleAuthOk && !apikeyAuthOk) {
    const authMeta = {
      hasSecret: Boolean(secret),
      hasBearer: Boolean(bearer),
      hasApikey: Boolean(apikey),
      secretConfigured: Boolean(expectedSecret),
      serviceRoleConfigured: Boolean(serviceRoleKey),
    };
    logger.warn('[admin/push] unauthorized request', authMeta);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { title?: string; body?: string; url?: string; targetId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { title, body: notifBody, url, targetId } = body;
  if (!title || !notifBody) {
    return NextResponse.json({ error: 'Missing title or body' }, { status: 400 });
  }

  const normalizedTargetId = normalizeAdminNotificationTargetId(targetId);
  let query = adminClient
    .from('web_push_subscriptions')
    .select('endpoint,p256dh,auth');

  if (normalizedTargetId) {
    if (normalizedTargetId.length !== 11) {
      return NextResponse.json({ ok: false, error: 'Notification target is not allowed' }, { status: 403 });
    }

    const targetRole = await resolveConcreteTargetRole(normalizedTargetId);
    if (!targetRole.ok) {
      const status = targetRole.reason === 'lookup_failed' ? 500 : 403;
      const error = targetRole.reason === 'lookup_failed'
        ? 'Notification target lookup failed'
        : 'Notification target is not allowed';
      return NextResponse.json({ ok: false, error }, { status });
    }

    query = query
      .eq('resident_id', normalizedTargetId)
      .eq('role', targetRole.role);
  } else {
    const sharedAdminTargets = await fetchSharedAdminResidentIds();
    if (!sharedAdminTargets.ok) {
      return NextResponse.json({ ok: false, error: 'Notification target lookup failed' }, { status: 500 });
    }
    if (sharedAdminTargets.residentIds.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, failed: 0, noTarget: true });
    }
    query = query
      .eq('role', 'admin')
      .in('resident_id', sharedAdminTargets.residentIds);
  }

  const { data: subs, error } = await query;

  if (error) {
    logger.error('[admin/push] subscriptions query failed', {
      reason: 'subscription_lookup_failed',
    });
    return NextResponse.json({ ok: false, error: 'Subscription lookup failed' }, { status: 500 });
  }

  if (!subs || subs.length === 0) {
    return NextResponse.json({
      ok: !normalizedTargetId,
      sent: 0,
      failed: 0,
      noTarget: true,
    });
  }

  const normalizedUrl = normalizeAdminDashboardUrl(url ?? '/dashboard');

  let result: Awaited<ReturnType<typeof sendWebPush>>;
  try {
    result = await sendWebPush(subs, {
      title,
      body: notifBody,
      data: { url: normalizedUrl },
    });
  } catch {
    logger.warn('[admin/push] delivery failed', {
      reason: 'provider_request_failed',
    });
    return NextResponse.json({
      ok: false,
      sent: 0,
      failed: subs.length,
      noTarget: false,
    });
  }

  if (result.expired.length > 0) {
    const { error: deleteError } = await adminClient
      .from('web_push_subscriptions')
      .delete()
      .in('endpoint', result.expired);
    if (deleteError) {
      logger.warn('[admin/push] expired subscription cleanup failed', {
        reason: 'subscription_cleanup_failed',
      });
    }
  }

  logger.debug('[admin/push] sent', { sent: result.sent, failed: result.failed });
  return NextResponse.json({
    ok: result.sent > 0 && result.failed === 0,
    sent: result.sent,
    failed: result.failed,
    noTarget: false,
  });
}
