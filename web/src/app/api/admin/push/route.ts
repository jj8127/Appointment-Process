import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { sendWebPush } from '@/lib/web-push';
import { logger } from '@/lib/logger';

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * Protected admin web push endpoint.
 * Called by the fc-notify Edge Function to send web push to all admin browser subscribers.
 *
 * Security: Validated via X-Admin-Push-Secret header (shared secret between Edge Function and Next.js).
 */
export async function POST(req: Request) {
  const secret = req.headers.get('X-Admin-Push-Secret');
  const expected = process.env.ADMIN_PUSH_SECRET;

  if (!expected || !secret || secret !== expected) {
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
