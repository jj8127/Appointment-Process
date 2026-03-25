import { NextResponse } from 'next/server';

import {
  backfillReferralCodes,
  disableReferralCode,
  getReferralAdminData,
  rotateReferralCode,
} from '@/lib/admin-referrals';
import { logger } from '@/lib/logger';
import { getVerifiedServerSession } from '@/lib/server-session';

type BackfillActionRequest = {
  action: 'backfill_missing_codes';
  payload?: {
    limit?: number;
  };
};

type RotateActionRequest = {
  action: 'rotate_code';
  payload?: {
    fcId?: string;
    reason?: string;
  };
};

type DisableActionRequest = {
  action: 'disable_code';
  payload?: {
    fcId?: string;
    reason?: string;
  };
};

type ReferralAdminRequest =
  | BackfillActionRequest
  | RotateActionRequest
  | DisableActionRequest;

const CLIENT_ERROR_MESSAGES = new Set([
  '추천코드 작업 권한이 없습니다.',
  '사유를 입력해주세요.',
  '추천코드 대상 FC를 찾을 수 없습니다.',
  '가입 완료된 FC만 추천코드를 발급할 수 있습니다.',
  '전화번호가 정규화된 11자리인 FC만 추천코드를 발급할 수 있습니다.',
  '설계매니저 계정에는 추천코드를 발급할 수 없습니다.',
  '운영 계정에는 추천코드를 발급할 수 없습니다.',
  '본부장 계정에는 추천코드를 발급할 수 없습니다.',
  '활성 추천코드가 없습니다.',
  '추천코드 생성 시 충돌이 반복되어 중단되었습니다.',
  '추천코드 작업 결과를 확인할 수 없습니다.',
]);

async function getReadSession() {
  return getVerifiedServerSession({ allowedRoles: ['admin', 'manager'], requireActive: true });
}

async function getWriteSession() {
  return getVerifiedServerSession({ allowedRoles: ['admin'], requireActive: true });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isClientError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return CLIENT_ERROR_MESSAGES.has(message);
}

export async function GET(req: Request) {
  const sessionCheck = await getReadSession();
  if (!sessionCheck.ok) {
    return NextResponse.json({ error: sessionCheck.error }, { status: sessionCheck.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const data = await getReferralAdminData(sessionCheck.session, {
      page: searchParams.get('page'),
      pageSize: searchParams.get('pageSize'),
      search: searchParams.get('search'),
      fcId: searchParams.get('fcId'),
    });

    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    logger.error('[api/admin/referrals] GET failed', error);
    return NextResponse.json({ error: '추천인 코드 조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const sessionCheck = await getWriteSession();
  if (!sessionCheck.ok) {
    return NextResponse.json({ error: sessionCheck.error }, { status: sessionCheck.status });
  }

  let body: ReferralAdminRequest;
  try {
    body = (await req.json()) as ReferralAdminRequest;
  } catch (error) {
    logger.error('[api/admin/referrals] invalid json', error);
    return badRequest('잘못된 JSON 요청입니다.');
  }

  const { action, payload } = body ?? {};
  if (!action) {
    return badRequest('action 값이 필요합니다.');
  }

  try {
    if (action === 'backfill_missing_codes') {
      const result = await backfillReferralCodes(sessionCheck.session, payload?.limit);
      return NextResponse.json({ ok: true, action, result });
    }

    if (action === 'rotate_code') {
      const fcId = payload?.fcId?.trim();
      const reason = payload?.reason?.trim();
      if (!fcId) {
        return badRequest('fcId 값이 필요합니다.');
      }
      if (!reason) {
        return badRequest('사유를 입력해주세요.');
      }

      const result = await rotateReferralCode(sessionCheck.session, fcId, reason);
      return NextResponse.json({ ok: true, action, result });
    }

    if (action === 'disable_code') {
      const fcId = payload?.fcId?.trim();
      const reason = payload?.reason?.trim();
      if (!fcId) {
        return badRequest('fcId 값이 필요합니다.');
      }
      if (!reason) {
        return badRequest('사유를 입력해주세요.');
      }

      const result = await disableReferralCode(sessionCheck.session, fcId, reason);
      return NextResponse.json({ ok: true, action, result });
    }

    return badRequest('지원하지 않는 action 입니다.');
  } catch (error) {
    logger.error('[api/admin/referrals] POST failed', error);
    if (isClientError(error)) {
      return badRequest(error instanceof Error ? error.message : String(error));
    }

    return NextResponse.json({ error: '추천인 코드 작업에 실패했습니다.' }, { status: 500 });
  }
}
