import { cookies } from 'next/headers';
import { parseUpstreamResponse, isGroupChatSuccess } from '@/lib/upstream-response-policy';
import { NextResponse } from 'next/server';

import { checkRateLimit, SECURITY_HEADERS, verifyOrigin } from '@/lib/csrf';
import {
  buildGroupChatFunctionHeaders,
  getGroupChatFunctionUrl,
  normalizeGroupChatProxyPayload,
} from '@/lib/group-chat-web';
import {
  WEB_APP_SESSION_COOKIE,
  createWebGroupChatAppSessionToken,
} from '@/lib/request-board-app-session';
import { getVerifiedServerSession } from '@/lib/server-session';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: SECURITY_HEADERS,
  });
}

export async function POST(req: Request) {
  if (!supabaseUrl || !serviceKey) {
    return json({
      ok: false,
      code: 'missing_group_chat_config',
      message: 'Missing Supabase group chat configuration',
    }, 500);
  }

  const originCheck = await verifyOrigin();
  if (!originCheck.valid) {
    return json({ ok: false, code: 'invalid_origin', message: originCheck.error ?? 'Invalid origin' }, 403);
  }

  const sessionCheck = await getVerifiedServerSession({
    allowedRoles: ['admin', 'manager'],
    requireActive: true,
  });
  if (!sessionCheck.ok) {
    return json({
      ok: false,
      code: sessionCheck.status === 401 ? 'invalid_session' : 'forbidden',
      message: sessionCheck.error,
    }, sessionCheck.status);
  }

  const rateLimit = checkRateLimit(
    `group-chat:${sessionCheck.session.role}:${sessionCheck.session.residentDigits}`,
    120,
    60_000,
  );
  if (!rateLimit.allowed) {
    return json({ ok: false, code: 'rate_limited', message: 'Too many requests' }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, code: 'invalid_json', message: 'Invalid JSON payload' }, 400);
  }

  const normalized = normalizeGroupChatProxyPayload(body, { supabaseUrl });
  if (!normalized.ok) {
    return json({ ok: false, code: 'invalid_payload', message: normalized.message }, normalized.status);
  }

  const cookieStore = await cookies();
  const cookieAppSessionToken = String(cookieStore.get(WEB_APP_SESSION_COOKIE)?.value ?? '').trim();
  const appSessionToken = cookieAppSessionToken || createWebGroupChatAppSessionToken(
    sessionCheck.session.residentDigits,
    sessionCheck.session.role,
    sessionCheck.session,
  );
  if (!appSessionToken) {
    return json({
      ok: false,
      code: 'missing_app_session',
      message: '단톡방 세션이 없습니다. 다시 로그인해 주세요.',
    }, 401);
  }

  try {
    const response = await fetch(getGroupChatFunctionUrl(supabaseUrl), {
      method: 'POST',
      headers: buildGroupChatFunctionHeaders(serviceKey, appSessionToken),
      body: JSON.stringify(normalized.payload),
    });
    const text = await response.text();
    const payload = parseUpstreamResponse(text);
    if (!payload || (response.ok && payload.ok === true && !isGroupChatSuccess(normalized.payload.type, payload))) {
      return json({ ok: false, code: 'invalid_group_chat_response', message: '단톡방 처리 결과를 확인하지 못했습니다. 상태를 확인한 뒤 다시 시도해주세요.' }, 502);
    }
    return json(payload, response.status);
  } catch (error) {
    return json({
      ok: false,
      code: 'group_chat_proxy_failed',
      message: error instanceof Error ? error.message : '단톡방 요청을 처리하지 못했습니다.',
    }, 500);
  }
}
