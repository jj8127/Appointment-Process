import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { checkRateLimit, SECURITY_HEADERS, verifyOrigin } from '@/lib/csrf';
import { WEB_APP_SESSION_COOKIE } from '@/lib/request-board-app-session';
import { getVerifiedServerSession } from '@/lib/server-session';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: SECURITY_HEADERS,
  });
}

export async function POST() {
  const originCheck = await verifyOrigin();
  if (!originCheck.valid) {
    return json({ ok: false, code: 'invalid_origin' }, 403);
  }

  const sessionCheck = await getVerifiedServerSession({
    allowedRoles: ['fc'],
    requireActive: true,
  });
  if (!sessionCheck.ok) {
    return json({
      ok: false,
      code: sessionCheck.status === 401 ? 'invalid_session' : 'forbidden',
    }, sessionCheck.status);
  }

  const rateLimit = checkRateLimit(
    `account-delete:self:${sessionCheck.session.residentDigits}`,
    3,
    60_000,
  );
  if (!rateLimit.allowed) {
    return json({ ok: false, code: 'rate_limited' }, 429);
  }
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, code: 'missing_delete_account_config' }, 500);
  }

  const cookieStore = await cookies();
  const appSessionToken = String(
    cookieStore.get(WEB_APP_SESSION_COOKIE)?.value ?? '',
  ).trim();
  if (!appSessionToken) {
    return json({ ok: false, code: 'missing_app_session' }, 401);
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/delete-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'x-app-session-token': appSessionToken,
      },
      body: JSON.stringify({
        role: 'fc',
        residentId: sessionCheck.session.residentDigits,
      }),
      cache: 'no-store',
    });
    const raw = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      return json({ ok: false, code: 'invalid_delete_account_response' }, 502);
    }

    if (!response.ok || payload.ok !== true || payload.deleted !== true) {
      return json({
        ok: false,
        code: 'delete_account_rejected',
      }, response.ok ? 409 : response.status);
    }

    return json({
      ok: true,
      deleted: true,
      cleanupWarning: payload.cleanupWarning === true,
    });
  } catch {
    return json({ ok: false, code: 'delete_account_unavailable' }, 502);
  }
}
