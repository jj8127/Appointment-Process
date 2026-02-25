import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
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

  let body: { title?: string; body?: string; url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { title, body: notifBody, url } = body;
  if (!title || !notifBody) {
    return NextResponse.json({ error: 'Missing title or body' }, { status: 400 });
  }

  const { data: subs, error } = await adminClient
    .from('web_push_subscriptions')
    .select('endpoint,p256dh,auth')
    .eq('role', 'admin');

  if (error) {
    logger.error('[admin/push] subscriptions query failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!subs || subs.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const result = await sendWebPush(subs, {
    title,
    body: notifBody,
    data: { url: url ?? '/dashboard' },
  });

  if (result.expired.length > 0) {
    const { error: deleteError } = await adminClient
      .from('web_push_subscriptions')
      .delete()
      .in('endpoint', result.expired);
    if (deleteError) {
      logger.warn('[admin/push] expired subscription cleanup failed:', deleteError);
    }
  }

  logger.debug('[admin/push] sent', { sent: result.sent, failed: result.failed });
  return NextResponse.json({ ok: true, sent: result.sent, failed: result.failed });
}
