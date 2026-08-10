import { createHash } from 'node:crypto';

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { adminSupabase } from '@/lib/admin-supabase';
import { ASSISTED_PASSWORD_CHANGE_COOKIE } from '@/lib/assisted-password-change-cookie';
import { checkRateLimit, verifyOrigin } from '@/lib/csrf';
import { logger } from '@/lib/logger';

type CompletionResponse = {
  ok?: boolean;
  code?: string;
  message?: string;
};

function clearChallengeCookie(response: NextResponse) {
  response.cookies.set(ASSISTED_PASSWORD_CHANGE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}

export async function POST(req: Request) {
  const originCheck = await verifyOrigin();
  if (!originCheck.valid) {
    return NextResponse.json({ ok: false, message: '허용되지 않은 요청 출처입니다.' }, { status: 403 });
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(ASSISTED_PASSWORD_CHANGE_COOKIE)?.value?.trim() ?? '';
  if (!token) {
    return NextResponse.json(
      { ok: false, code: 'missing_password_change_token', message: '다시 로그인해주세요.' },
      { status: 401 },
    );
  }

  const rateKey = createHash('sha256').update(token).digest('hex').slice(0, 24);
  const rateLimit = checkRateLimit(`assisted-password-change:${rateKey}`, 10, 15 * 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { ok: false, message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 },
    );
  }

  let body: { newPassword?: string; confirm?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: '잘못된 요청 형식입니다.' }, { status: 400 });
  }

  const newPassword = String(body.newPassword ?? '').trim();
  const confirm = String(body.confirm ?? '').trim();
  if (!newPassword || !confirm || newPassword.length > 128 || confirm.length > 128) {
    return NextResponse.json({ ok: false, message: '새 비밀번호를 확인해주세요.' }, { status: 400 });
  }

  const { data, error } = await adminSupabase.functions.invoke<CompletionResponse>(
    'complete-assisted-password',
    { body: { token, newPassword, confirm } },
  );

  if (error) {
    logger.warn('[api/auth/complete-assisted-password] upstream failed', {
      name: typeof error.name === 'string' ? error.name : 'UnknownError',
    });
    return NextResponse.json(
      { ok: false, message: '비밀번호 변경 서버에 연결하지 못했습니다.' },
      { status: 502 },
    );
  }

  if (data?.ok !== true) {
    const shouldClear =
      data?.code === 'invalid_password_change_token'
      || data?.code === 'expired_password_change_token'
      || data?.code === 'password_change_not_required';
    const response = NextResponse.json(
      { ok: false, code: data?.code, message: data?.message ?? '비밀번호를 변경하지 못했습니다.' },
      { status: 400 },
    );
    return shouldClear ? clearChallengeCookie(response) : response;
  }

  return clearChallengeCookie(NextResponse.json({ ok: true }));
}
