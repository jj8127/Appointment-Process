import type { RecommenderRelationActorContext } from '@/lib/admin-referrals';
import type { VerifiedServerSession } from '@/lib/server-session';

type SessionCheckResult =
  | { ok: true; session: VerifiedServerSession }
  | { ok: false; status: number; error: string };

type RouteResponse = {
  status: number;
  body: Record<string, unknown>;
};

type SearchResult = {
  candidates: unknown[];
  selectedCandidate: unknown | null;
};

type ApplyResult = {
  changed: boolean;
  inviteeFcId: string;
  inviterFcId: string | null;
  recommenderName: string | null;
  referralCode: string | null;
};

export type RecommenderRelationRouteDeps = {
  getSession: () => Promise<SessionCheckResult>;
  searchCandidates: (params: {
    query?: string | null;
    excludeFcId?: string | null;
    selectedFcId?: string | null;
  }) => Promise<SearchResult>;
  applySelection: (params: {
    actor: RecommenderRelationActorContext;
    inviteeFcId: string;
    inviterFcId: string | null;
    reason: string;
  }) => Promise<ApplyResult>;
  logFailure?: (error: unknown) => void;
};

const RECOMMENDER_RPC_NOT_READY_MESSAGE =
  '운영 DB에 추천인 상태 단일화 함수가 아직 적용되지 않았습니다. migration 20260423000001을 먼저 반영해주세요.';

const CLIENT_ERROR_MESSAGES = new Set([
  '추천인 대상 FC를 찾을 수 없습니다.',
  '추천인 후보 FC를 찾을 수 없습니다.',
  '추천인 변경 사유를 입력해주세요.',
  '활성 추천코드가 있는 FC만 추천인으로 선택할 수 있습니다.',
  '추천인으로 지정할 수 없는 FC입니다.',
  '자기 자신을 추천인으로 지정할 수 없습니다.',
  '추천 관계 대상 FC 전화번호가 올바르지 않습니다.',
  '추천인 후보 FC 전화번호가 올바르지 않습니다.',
]);

function response(status: number, body: Record<string, unknown>): RouteResponse {
  return { status, body };
}

function badRequest(message: string) {
  return response(400, { error: message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isRetiredLegacyRecommenderSearchAction(action: unknown): boolean {
  return action === 'searchRecommenders';
}

export function hasRetiredLegacyRecommenderMutationFields(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ['recommender', 'recommenderFcId', 'recommenderOverrideReason'].some((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

export function isManagerShadowRecommenderEligible(input: {
  isManagerReferralShadow: boolean;
  normalizedPhone: string;
  activeManagerPhones: ReadonlySet<string>;
}): boolean {
  return (
    !input.isManagerReferralShadow
    || input.activeManagerPhones.has(input.normalizedPhone)
  );
}

export function resolveVerifiedRecommenderRelationActor(
  session: VerifiedServerSession,
): RecommenderRelationActorContext {
  if (session.role === 'manager') {
    return {
      actorPhone: session.residentDigits,
      actorRole: 'manager',
      actorStaffType: null,
    };
  }
  if (session.role === 'admin' && (session.staffType === 'admin' || session.staffType === 'developer')) {
    return {
      actorPhone: session.residentDigits,
      actorRole: 'admin',
      actorStaffType: session.staffType,
    };
  }
  throw new Error('Forbidden');
}

async function requireActor(
  deps: RecommenderRelationRouteDeps,
): Promise<
  | { ok: true; actor: RecommenderRelationActorContext }
  | { ok: false; response: RouteResponse }
> {
  const sessionCheck = await deps.getSession();
  if (!sessionCheck.ok) {
    return {
      ok: false,
      response: response(sessionCheck.status, { error: sessionCheck.error }),
    };
  }

  try {
    return {
      ok: true,
      actor: resolveVerifiedRecommenderRelationActor(sessionCheck.session),
    };
  } catch {
    return {
      ok: false,
      response: response(403, { error: 'Forbidden' }),
    };
  }
}

function handleFailure(error: unknown, deps: RecommenderRelationRouteDeps): RouteResponse {
  deps.logFailure?.(error);
  const message = error instanceof Error ? error.message : String(error);
  if (message === RECOMMENDER_RPC_NOT_READY_MESSAGE) {
    return response(503, { error: RECOMMENDER_RPC_NOT_READY_MESSAGE });
  }
  if (CLIENT_ERROR_MESSAGES.has(message)) {
    return badRequest(message);
  }
  return response(500, { error: '추천인 관계 작업에 실패했습니다.' });
}

export async function handleRecommenderRelationGet(
  requestUrl: string,
  deps: RecommenderRelationRouteDeps,
): Promise<RouteResponse> {
  const auth = await requireActor(deps);
  if (!auth.ok) return auth.response;

  try {
    const searchParams = new URL(requestUrl).searchParams;
    const result = await deps.searchCandidates({
      query: searchParams.get('query'),
      excludeFcId: searchParams.get('inviteeFcId'),
      selectedFcId: searchParams.get('selectedFcId'),
    });
    return response(200, { ok: true, ...result });
  } catch (error: unknown) {
    return handleFailure(error, deps);
  }
}

export async function handleRecommenderRelationPost(
  readJson: () => Promise<unknown>,
  deps: RecommenderRelationRouteDeps,
): Promise<RouteResponse> {
  const auth = await requireActor(deps);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    const parsed = await readJson();
    if (!isRecord(parsed)) return badRequest('Invalid JSON payload');
    body = parsed;
  } catch {
    return badRequest('Invalid JSON payload');
  }

  const inviteeFcId = typeof body.inviteeFcId === 'string' ? body.inviteeFcId.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!inviteeFcId) return badRequest('inviteeFcId is required');
  if (!reason) return badRequest('추천인 변경 사유를 입력해주세요.');
  if (!Object.prototype.hasOwnProperty.call(body, 'inviterFcId')) {
    return badRequest('inviterFcId is required');
  }
  if (body.inviterFcId !== null && typeof body.inviterFcId !== 'string') {
    return badRequest('inviterFcId must be a string or null');
  }
  const inviterFcId = typeof body.inviterFcId === 'string'
    ? body.inviterFcId.trim() || null
    : null;

  try {
    const result = await deps.applySelection({
      actor: auth.actor,
      inviteeFcId,
      inviterFcId,
      reason,
    });
    return response(200, { ok: true, result });
  } catch (error: unknown) {
    return handleFailure(error, deps);
  }
}
