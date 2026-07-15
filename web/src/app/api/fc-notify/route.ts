import { NextResponse } from 'next/server';

import { buildAdminChatTargets } from '@/lib/admin-chat-targets';
import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, SECURITY_HEADERS } from '@/lib/csrf';
import {
  buildBrowserFcNotifyPayload,
  buildRequestBoardNotifyPayload,
  classifyFcNotifyIngress,
  verifyBrowserSameOrigin,
  verifyRequestBoardBridgeToken,
  type BrowserFcNotifyPayload,
} from '@/lib/fc-notify-proxy-policy';
import { logger } from '@/lib/logger';
import { buildPhoneCandidates, getVerifiedServerSession } from '@/lib/server-session';
import { sendWebPush } from '@/lib/web-push';

export const runtime = 'nodejs';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: SECURITY_HEADERS,
  });
}

function getBrowserRateLimit(action: BrowserFcNotifyPayload['type']) {
  if (action === 'message') return 20;
  if (action === 'inbox_list') return 60;
  return 120;
}

async function isEligibleFcTarget(targetId: string) {
  const phoneCandidates = buildPhoneCandidates(targetId, targetId);
  const { data, error } = await adminSupabase
    .from('fc_profiles')
    .select('id,name,phone,signup_completed,affiliation')
    .in('phone', phoneCandidates)
    .eq('signup_completed', true)
    .limit(phoneCandidates.length);

  if (error) throw error;
  return buildAdminChatTargets(data ?? []).some((target) => target.phone === targetId);
}

async function sendBrowserFcMessageWebPush(payload: BrowserFcNotifyPayload) {
  if (payload.type !== 'message' || payload.target_role !== 'fc') return;

  const { data: subscriptions, error } = await adminSupabase
    .from('web_push_subscriptions')
    .select('endpoint,p256dh,auth')
    .eq('role', 'fc')
    .eq('resident_id', payload.target_id);

  if (error) {
    logger.warn('[fc-notify] FC web push subscriptions unavailable', { message: error.message });
    return;
  }
  if (!subscriptions?.length) return;

  const result = await sendWebPush(subscriptions, {
    title: '새 메시지',
    body: payload.message,
    data: { url: '/chat' },
  });

  if (result.expired.length > 0) {
    const { error: deleteError } = await adminSupabase
      .from('web_push_subscriptions')
      .delete()
      .in('endpoint', result.expired);
    if (deleteError) {
      logger.warn('[fc-notify] Failed to delete expired FC subscriptions', {
        message: deleteError.message,
      });
    }
  }
}

async function proxyToFcNotify(payload: BrowserFcNotifyPayload | Record<string, unknown>) {
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'FC notification service is not configured' }, 500);
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/fc-notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return json({ status: response.status, ok: response.ok, data }, response.status);
}

export async function POST(req: Request) {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400);
  }

  const bridgeToken = req.headers.get('x-request-bridge-token');
  const ingress = classifyFcNotifyIngress(rawBody, bridgeToken);
  if (!ingress.ok) return json({ error: ingress.error }, ingress.status);

  try {
    if (ingress.ingress === 'request_board') {
      const expectedBridgeToken = process.env.REQUEST_BOARD_NOTIFY_TOKEN;
      if (
        expectedBridgeToken
        && !verifyRequestBoardBridgeToken(bridgeToken, expectedBridgeToken)
      ) {
        return json({ error: 'Invalid Request Board bridge token' }, 401);
      }
      const bridgePolicy = buildRequestBoardNotifyPayload({
        body: rawBody,
        providedToken: bridgeToken,
        expectedToken: expectedBridgeToken,
      });
      if (!bridgePolicy.ok) return json({ error: bridgePolicy.error }, bridgePolicy.status);

      const rateLimit = checkRateLimit(
        `fc-notify:request-board:${bridgePolicy.payload.target_id}:${bridgePolicy.payload.category}`,
        120,
        60_000,
      );
      if (!rateLimit.allowed) return json({ error: 'Too many requests' }, 429);

      return await proxyToFcNotify(bridgePolicy.payload);
    }

    const originPolicy = verifyBrowserSameOrigin({
      origin: req.headers.get('origin'),
      referer: req.headers.get('referer'),
      host: req.headers.get('host'),
      requestUrl: req.url,
    });
    if (!originPolicy.ok) return json({ error: originPolicy.error }, originPolicy.status);

    const sessionCheck = await getVerifiedServerSession({
      allowedRoles: ['admin', 'manager', 'fc'],
      requireActive: true,
    });
    if (!sessionCheck.ok) {
      return json({ error: sessionCheck.error }, sessionCheck.status);
    }

    const browserPolicy = buildBrowserFcNotifyPayload({
      body: rawBody,
      session: sessionCheck.session,
    });
    if (!browserPolicy.ok) return json({ error: browserPolicy.error }, browserPolicy.status);

    const rateLimit = checkRateLimit(
      `fc-notify:browser:${sessionCheck.session.role}:${sessionCheck.session.residentDigits}:${browserPolicy.payload.type}`,
      getBrowserRateLimit(browserPolicy.payload.type),
      60_000,
    );
    if (!rateLimit.allowed) return json({ error: 'Too many requests' }, 429);

    if (
      (browserPolicy.payload.type === 'message' || browserPolicy.payload.type === 'notify')
      && browserPolicy.payload.target_role === 'fc'
      && !await isEligibleFcTarget(browserPolicy.payload.target_id)
    ) {
      return json({ error: 'FC notification target is not allowed' }, 403);
    }

    await sendBrowserFcMessageWebPush(browserPolicy.payload);
    return await proxyToFcNotify(browserPolicy.payload);
  } catch (error: unknown) {
    logger.error('[api/fc-notify] protected proxy failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ error: '\uc694\uccad \ucc98\ub9ac\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4.' }, 500);
  }
}
