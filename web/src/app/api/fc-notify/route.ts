import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { buildAdminDashboardChatUrl, normalizeAdminDashboardUrl } from '@/lib/admin-chat-url';
import { sendWebPush } from '@/lib/web-push';
import { redactSensitiveStrings } from '@/lib/sensitive-text';

import { logger } from '@/lib/logger';
// Validate environment variables at module load time
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error(
    'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
  );
}

// Create admin client with service role key (server-side only)
const adminClient = createClient(supabaseUrl, serviceKey);

/**
 * Request body type for fc-notify
 */
interface NotifyRequestBody {
  type?: string;
  target_role?: 'admin' | 'fc';
  target_id?: string | null;
  message?: string;
  sender_id?: string;
  title?: string;
  body?: string;
  url?: string;
  [key: string]: unknown;
}

const sanitizePhoneDigits = (value: string | null | undefined) => String(value ?? '').replace(/[^0-9]/g, '');
const ADMIN_CHAT_ID = 'admin';

const normalizeAdminNotificationTargetId = (value: string | null | undefined) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === ADMIN_CHAT_ID) return '';
  return sanitizePhoneDigits(raw);
};

async function fetchSharedAdminResidentIds() {
  const { data, error } = await adminClient
    .from('admin_accounts')
    .select('phone,staff_type')
    .eq('active', true);

  if (error) {
    logger.error('[fc-notify] Error fetching shared admin accounts:', error);
    return [];
  }

  return Array.from(
    new Set(
      (data ?? [])
        .filter((account) => account.staff_type !== 'developer')
        .map((account) => sanitizePhoneDigits(account.phone))
        .filter((phone) => phone.length > 0),
    ),
  );
}

async function fetchAdminWebPushSubscriptions(targetId?: string | null) {
  const normalizedTargetId = normalizeAdminNotificationTargetId(targetId);
  const query = adminClient
    .from('web_push_subscriptions')
    .select('endpoint,p256dh,auth')
    .eq('role', 'admin');

  if (normalizedTargetId) {
    return query.eq('resident_id', normalizedTargetId);
  }

  const sharedAdminResidentIds = await fetchSharedAdminResidentIds();
  if (sharedAdminResidentIds.length === 0) {
    return { data: [], error: null };
  }

  return query.in('resident_id', sharedAdminResidentIds);
}

/**
 * FC Notification API Route
 *
 * Security: This route is server-side only. Service role key never exposed to client.
 * The route acts as a proxy to Supabase Edge Functions and handles web push notifications.
 */
export async function POST(req: Request) {
  let body: NotifyRequestBody;

  try {
    body = await req.json() as NotifyRequestBody;
  } catch (parseError) {
    logger.error('[fc-notify] JSON parse error:', parseError);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  // Validate body
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  body = redactSensitiveStrings(body);

  try {
    // Handle web push notifications for admin-targeted notify events (docs, exam, consent, etc.)
    if (body.type === 'notify' && body.target_role === 'admin') {
      const title = body.title ?? '새 알림';
      const message = body.body ?? '새로운 알림이 도착했습니다.';
      const url = normalizeAdminDashboardUrl(body.url ?? '/dashboard');

      const { data: subs, error: subsError } = await fetchAdminWebPushSubscriptions(body.target_id);

      if (subsError) {
        logger.error('[fc-notify] Error fetching admin subscriptions:', subsError);
      } else if (subs && subs.length > 0) {
        const result = await sendWebPush(subs, { title, body: message, data: { url } });
        if (result.expired.length > 0) {
          const { error: deleteError } = await adminClient
            .from('web_push_subscriptions')
            .delete()
            .in('endpoint', result.expired);
          if (deleteError) {
            logger.error('[fc-notify] Error deleting expired subscriptions:', deleteError);
          }
        }
      }
    }

    // Handle web push notifications for messages
    if (body.type === 'message') {
      const targetRole = body.target_role;
      const targetId = body.target_id;
      const message = body.message ?? '새로운 메시지가 도착했습니다.';

      if (targetRole === 'admin') {
        const { data: subs, error: subsError } = await fetchAdminWebPushSubscriptions(targetId);
        if (subsError) {
          logger.error('[fc-notify] Error fetching subscriptions:', subsError);
        } else if (subs && subs.length > 0) {
          const senderId = sanitizePhoneDigits(String(body.sender_id ?? ''));
          let senderName = String(body.sender_name ?? '').trim();

          if (senderId && !senderName) {
            const { data: senderProfile, error: senderProfileError } = await adminClient
              .from('fc_profiles')
              .select('name')
              .eq('phone', senderId)
              .maybeSingle();

            if (senderProfileError) {
              logger.warn('[fc-notify] sender profile lookup failed:', senderProfileError);
            } else {
              senderName = senderProfile?.name?.trim() ?? '';
            }
          }

          const url = buildAdminDashboardChatUrl({
            targetId: senderId,
            targetName: senderName,
          });

          const result = await sendWebPush(subs, {
            title: '새 메시지',
            body: message,
            data: { url },
          });

          if (result.expired.length > 0) {
            const { error: deleteError } = await adminClient
              .from('web_push_subscriptions')
              .delete()
              .in('endpoint', result.expired);

            if (deleteError) {
              logger.error('[fc-notify] Error deleting expired subscriptions:', deleteError);
            }
          }
        }
      } else if (targetRole === 'fc' && targetId) {
        const { data: subs, error: subsError } = await adminClient
          .from('web_push_subscriptions')
          .select('endpoint,p256dh,auth')
          .eq('role', 'fc')
          .eq('resident_id', targetId);

        if (subsError) {
          logger.error('[fc-notify] Error fetching subscriptions:', subsError);
        } else if (subs && subs.length > 0) {
          const result = await sendWebPush(subs, {
            title: '새 메시지',
            body: message,
            data: { url: '/chat' },
          });

          // Clean up expired subscriptions
          if (result.expired.length > 0) {
            const { error: deleteError } = await adminClient
              .from('web_push_subscriptions')
              .delete()
              .in('endpoint', result.expired);

            if (deleteError) {
              logger.error('[fc-notify] Error deleting expired subscriptions:', deleteError);
            }
          }
        }
      }
    }

    // Proxy request to Supabase Edge Function
    const resp = await fetch(`${supabaseUrl}/functions/v1/fc-notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey as string,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    let data: unknown = null;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return NextResponse.json(
      { status: resp.status, ok: resp.ok, data },
      { status: resp.status },
    );
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[api/fc-notify] proxy error:', error?.message ?? err);

    return NextResponse.json(
      { error: '요청 처리에 실패했습니다.' },
      { status: 500 },
    );
  }
}
