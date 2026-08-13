import { NextResponse } from 'next/server';

import {
  adminAssistedSignupSchema,
  firstAdminAssistedSignupError,
  type SignupReferralSearchResult,
} from '@/lib/admin-assisted-signup-contract';
import { createAdminAssistedSignup } from '@/lib/admin-assisted-signup-server';
import { adminRouteAuthErrorResponse, requireAdminRoute } from '@/lib/admin-route-auth';
import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, verifyOrigin } from '@/lib/csrf';
import { logger } from '@/lib/logger';

const RPC_ERROR_MESSAGES: Record<string, { status: number; message: string }> = {
  assisted_signup_forbidden: { status: 403, message: '회원가입 생성 권한이 없습니다.' },
  assisted_signup_request_conflict: { status: 409, message: '동일한 요청 번호가 다른 작업에 사용되었습니다.' },
  assisted_signup_already_exists: { status: 409, message: '이미 가입되었거나 비밀번호가 설정된 번호입니다.' },
  assisted_signup_referral_required: { status: 400, message: '추천인을 다시 검색해 선택해주세요.' },
  assisted_signup_referral_failed: { status: 409, message: '추천인 연결을 완료하지 못했습니다.' },
  assisted_signup_invalid_consent_date: { status: 400, message: '서면 확인일을 확인해주세요.' },
  assisted_signup_invalid_evidence_reference: { status: 400, message: '문서관리번호를 확인해주세요.' },
  assisted_signup_invalid_profile: { status: 400, message: '회원 정보를 확인해주세요.' },
  assisted_signup_invalid_license_statuses: { status: 400, message: '보유 자격을 확인해주세요.' },
};

function rpcErrorResponse(error: unknown) {
  const code = typeof error === 'object' && error !== null
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '');
  const known = RPC_ERROR_MESSAGES[rawMessage];

  logger.warn('[api/admin/assisted-signup] mutation rejected', {
    code: code || 'unknown',
    reason: known ? rawMessage : 'unclassified',
  });

  if (known) {
    return NextResponse.json({ ok: false, message: known.message }, { status: known.status });
  }
  if (code === '42883') {
    return NextResponse.json(
      { ok: false, message: '관리자 서면확인 회원가입 스키마가 아직 준비되지 않았습니다.' },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { ok: false, message: '회원가입을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.' },
    { status: 500 },
  );
}

function hasAssistedSignupPermission(session: { role: string; staffType: string | null }) {
  return session.role === 'admin'
    && (session.staffType === 'admin' || session.staffType === 'developer');
}

async function requireMutationBoundary() {
  const sessionCheck = await requireAdminRoute();
  if (!sessionCheck.ok) {
    return { response: adminRouteAuthErrorResponse(sessionCheck) } as const;
  }
  if (!hasAssistedSignupPermission(sessionCheck.session)) {
    return {
      response: NextResponse.json({ ok: false, message: '회원가입 생성 권한이 없습니다.' }, { status: 403 }),
    } as const;
  }

  const originCheck = await verifyOrigin();
  if (!originCheck.valid) {
    return {
      response: NextResponse.json({ ok: false, message: '허용되지 않은 요청 출처입니다.' }, { status: 403 }),
    } as const;
  }

  const rateLimit = checkRateLimit(
    `admin-assisted-signup:${sessionCheck.session.residentDigits}`,
    10,
    60_000,
  );
  if (!rateLimit.allowed) {
    return {
      response: NextResponse.json({ ok: false, message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 }),
    } as const;
  }

  return { session: sessionCheck.session } as const;
}

export async function GET(req: Request) {
  const sessionCheck = await requireAdminRoute();
  if (!sessionCheck.ok) {
    return adminRouteAuthErrorResponse(sessionCheck);
  }
  if (!hasAssistedSignupPermission(sessionCheck.session)) {
    return NextResponse.json({ ok: false, message: '회원가입 생성 권한이 없습니다.' }, { status: 403 });
  }

  const query = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (query.length < 2) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const rateLimit = checkRateLimit(
    `admin-assisted-signup-search:${sessionCheck.session.residentDigits}`,
    30,
    60_000,
  );
  if (!rateLimit.allowed) {
    return NextResponse.json({ ok: false, message: '검색 요청이 너무 많습니다.' }, { status: 429 });
  }

  const { data, error } = await adminSupabase.functions.invoke<{
    ok?: boolean;
    results?: SignupReferralSearchResult[];
    message?: string;
  }>('search-signup-referral', {
    body: { query: query.slice(0, 40) },
  });

  if (error || data?.ok !== true) {
    logger.warn('[api/admin/assisted-signup] referral search failed', {
      code: typeof error === 'object' && error !== null && 'name' in error
        ? String(error.name)
        : 'upstream_rejected',
    });
    return NextResponse.json(
      { ok: false, message: '추천인 검색을 지금 사용할 수 없습니다.' },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, results: data.results ?? [] });
}

export async function POST(req: Request) {
  const boundary = await requireMutationBoundary();
  if ('response' in boundary) {
    return boundary.response;
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: '잘못된 요청 형식입니다.' }, { status: 400 });
  }

  const parsed = adminAssistedSignupSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: firstAdminAssistedSignupError(parsed.error) },
      { status: 400 },
    );
  }

  try {
    const result = await createAdminAssistedSignup(parsed.data, boundary.session);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return rpcErrorResponse(error);
  }
}
