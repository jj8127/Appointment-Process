import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  buildBoardFunctionHeaders,
  getBoardFunctionUrl,
  normalizeBoardProxyRequest,
} from '@/lib/board-web-proxy';
import { checkRateLimit, SECURITY_HEADERS, verifyOrigin } from '@/lib/csrf';
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
  const originCheck = await verifyOrigin();
  if (!originCheck.valid) {
    return json({
      ok: false,
      code: 'invalid_origin',
      message: originCheck.error ?? 'Invalid origin',
    }, 403);
  }

  const sessionCheck = await getVerifiedServerSession({
    allowedRoles: ['admin', 'manager', 'fc'],
    requireActive: true,
  });
  if (!sessionCheck.ok) {
    return json({
      ok: false,
      code: sessionCheck.status === 401 ? 'invalid_session' : 'forbidden',
      message: sessionCheck.error,
    }, sessionCheck.status);
  }
  const session = sessionCheck.session;

  const rateLimit = checkRateLimit(
    `board:${session.role}:${session.residentDigits}`,
    120,
    60_000,
  );
  if (!rateLimit.allowed) {
    return json({
      ok: false,
      code: 'rate_limited',
      message: 'Too many requests',
    }, 429);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({
      ok: false,
      code: 'invalid_json',
      message: 'Invalid JSON payload',
    }, 400);
  }

  const normalized = normalizeBoardProxyRequest(body, {
    role: session.role,
    residentId: session.residentDigits,
    displayName: session.displayName,
  });
  if (!normalized.ok) {
    return json({
      ok: false,
      code: normalized.code,
      message: normalized.message,
    }, normalized.status);
  }

  if (!supabaseUrl || !serviceKey) {
    return json({
      ok: false,
      code: 'missing_board_config',
      message: 'Missing Supabase board configuration',
    }, 500);
  }

  const cookieStore = await cookies();
  const cookieAppSessionToken = String(
    cookieStore.get(WEB_APP_SESSION_COOKIE)?.value ?? '',
  ).trim();
  const appSessionToken = cookieAppSessionToken || createWebGroupChatAppSessionToken(
    session.residentDigits,
    session.role,
  );
  if (!appSessionToken) {
    return json({
      ok: false,
      code: 'missing_app_session',
      message: '게시판 세션이 없습니다. 다시 로그인해주세요.',
    }, 401);
  }

  try {
    const response = await fetch(
      getBoardFunctionUrl(supabaseUrl, normalized.functionName),
      {
        method: 'POST',
        headers: buildBoardFunctionHeaders(serviceKey, appSessionToken),
        body: JSON.stringify(normalized.payload),
        cache: 'no-store',
      },
    );
    const raw = await response.text();
    let payload: Record<string, unknown>;
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : { ok: response.ok };
    } catch {
      payload = {
        ok: false,
        code: 'invalid_board_response',
        message: '게시판 요청을 처리하지 못했습니다.',
      };
    }

    return json(payload, response.status);
  } catch {
    return json({
      ok: false,
      code: 'board_proxy_failed',
      message: '게시판 요청을 처리하지 못했습니다.',
    }, 500);
  }
}
