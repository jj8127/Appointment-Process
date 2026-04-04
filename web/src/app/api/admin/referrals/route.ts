import { NextResponse } from 'next/server';

import {
  autoResolveLegacyRecommenders,
  backfillReferralCodes,
  clearLegacyRecommender,
  disableReferralCode,
  getReferralAdminData,
  linkLegacyRecommender,
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

type LinkLegacyActionRequest = {
  action: 'link_legacy_recommender';
  payload?: {
    inviteeFcId?: string;
    inviterFcId?: string;
    reason?: string;
  };
};

type ClearLegacyActionRequest = {
  action: 'clear_legacy_recommender';
  payload?: {
    inviteeFcId?: string;
    reason?: string;
  };
};

type AutoResolveLegacyActionRequest = {
  action: 'auto_resolve_legacy_recommenders';
  payload?: {
    limit?: number;
    reason?: string;
  };
};

type ReferralAdminRequest =
  | BackfillActionRequest
  | RotateActionRequest
  | DisableActionRequest
  | LinkLegacyActionRequest
  | ClearLegacyActionRequest
  | AutoResolveLegacyActionRequest;

const CLIENT_ERROR_MESSAGES = new Set([
  '추천코드 작업 권한이 없습니다.',
  '사유를 입력해주세요.',
  '추천코드 대상 FC를 찾을 수 없습니다.',
  '가입 완료된 FC만 추천코드를 발급할 수 있습니다.',
  '가입 완료된 FC 또는 활성 본부장 계정만 추천코드를 발급할 수 있습니다.',
  '전화번호가 정규화된 11자리인 FC만 추천코드를 발급할 수 있습니다.',
  '설계매니저 계정에는 추천코드를 발급할 수 없습니다.',
  '운영 계정에는 추천코드를 발급할 수 없습니다.',
  '본부장 계정에는 추천코드를 발급할 수 없습니다.',
  '본부장 추천인 전용 프로필을 정리할 수 없습니다. 기존 FC 데이터와 전화번호 충돌 여부를 확인해주세요.',
  '활성 본부장 계정을 찾을 수 없습니다.',
  '활성 추천코드가 없습니다.',
  '추천코드 생성 시 충돌이 반복되어 중단되었습니다.',
  '추천코드 작업 결과를 확인할 수 없습니다.',
  '추천인 대상 FC를 찾을 수 없습니다.',
  '추천인 후보 FC를 찾을 수 없습니다.',
  '추천인 변경 사유를 입력해주세요.',
  '활성 추천코드가 있는 FC만 추천인으로 선택할 수 있습니다.',
  '자기 자신을 추천인으로 지정할 수 없습니다.',
  '추천 관계 대상 FC 전화번호가 올바르지 않습니다.',
  '추천인 후보 FC 전화번호가 올바르지 않습니다.',
]);

const RECOMMENDER_RPC_NOT_READY_MESSAGE =
  '운영 DB에 추천인 override 함수가 아직 적용되지 않았습니다. migration 20260331000005를 먼저 반영해주세요.';

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

function isInfrastructureError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message === RECOMMENDER_RPC_NOT_READY_MESSAGE;
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

    if (action === 'link_legacy_recommender') {
      const inviteeFcId = payload?.inviteeFcId?.trim();
      const inviterFcId = payload?.inviterFcId?.trim();
      const reason = payload?.reason?.trim();
      if (!inviteeFcId) {
        return badRequest('inviteeFcId 값이 필요합니다.');
      }
      if (!inviterFcId) {
        return badRequest('inviterFcId 값이 필요합니다.');
      }
      if (!reason) {
        return badRequest('사유를 입력해주세요.');
      }

      const result = await linkLegacyRecommender(sessionCheck.session, inviteeFcId, inviterFcId, reason);
      return NextResponse.json({ ok: true, action, result });
    }

    if (action === 'clear_legacy_recommender') {
      const inviteeFcId = payload?.inviteeFcId?.trim();
      const reason = payload?.reason?.trim();
      if (!inviteeFcId) {
        return badRequest('inviteeFcId 값이 필요합니다.');
      }
      if (!reason) {
        return badRequest('사유를 입력해주세요.');
      }

      const result = await clearLegacyRecommender(sessionCheck.session, inviteeFcId, reason);
      return NextResponse.json({ ok: true, action, result });
    }

    if (action === 'auto_resolve_legacy_recommenders') {
      const result = await autoResolveLegacyRecommenders(
        sessionCheck.session,
        payload?.limit,
        payload?.reason,
      );
      return NextResponse.json({ ok: true, action, result });
    }

    return badRequest('지원하지 않는 action 입니다.');
  } catch (error) {
    logger.error('[api/admin/referrals] POST failed', error);
    if (isInfrastructureError(error)) {
      return NextResponse.json({ error: RECOMMENDER_RPC_NOT_READY_MESSAGE }, { status: 503 });
    }
    if (isClientError(error)) {
      return badRequest(error instanceof Error ? error.message : String(error));
    }

    return NextResponse.json({ error: '추천인 코드 작업에 실패했습니다.' }, { status: 500 });
  }
}
