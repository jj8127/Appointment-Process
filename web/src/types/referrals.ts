export type RecommenderCandidate = {
  fcId: string;
  name: string;
  affiliation: string;
  phoneLast4: string | null;
  activeCode: string | null;
  label: string;
  descriptor: string;
};

export type ReferralAdminListItem = {
  fcId: string;
  name: string;
  phone: string;
  affiliation: string;
  activeCode: string | null;
  activeCodeCreatedAt: string | null;
  disabledCodeCount: number;
  lastEventAt: string | null;
};

export type ReferralAdminCodeHistoryItem = {
  id: string;
  code: string;
  isActive: boolean;
  createdAt: string;
  disabledAt: string | null;
};

export type ReferralAdminEventItem = {
  id: string;
  eventType: string;
  createdAt: string;
  referralCode: string | null;
  metadata: Record<string, unknown>;
};

export type ReferralAdminDetail = {
  fcId: string;
  name: string;
  phone: string;
  affiliation: string;
  currentCode: ReferralAdminCodeHistoryItem | null;
  codeHistory: ReferralAdminCodeHistoryItem[];
  recentEvents: ReferralAdminEventItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isReferralAdminCodeHistoryItem(value: unknown): value is ReferralAdminCodeHistoryItem {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.code === 'string'
    && typeof value.isActive === 'boolean'
    && typeof value.createdAt === 'string'
    && isNullableString(value.disabledAt);
}

function isReferralAdminEventItem(value: unknown): value is ReferralAdminEventItem {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.eventType === 'string'
    && typeof value.createdAt === 'string'
    && isNullableString(value.referralCode)
    && isRecord(value.metadata);
}

export function isReferralAdminDetail(value: unknown): value is ReferralAdminDetail {
  return isRecord(value)
    && typeof value.fcId === 'string'
    && typeof value.name === 'string'
    && typeof value.phone === 'string'
    && typeof value.affiliation === 'string'
    && (value.currentCode === null || isReferralAdminCodeHistoryItem(value.currentCode))
    && Array.isArray(value.codeHistory)
    && value.codeHistory.every(isReferralAdminCodeHistoryItem)
    && Array.isArray(value.recentEvents)
    && value.recentEvents.every(isReferralAdminEventItem);
}

export type ReferralAdminSummary = {
  eligibleCount: number;
  activeCodeCount: number;
  missingCodeCount: number;
  disabledCodeCount: number;
  unresolvedLegacyCount: number;
};

export type ReferralAdminUnresolvedItem = {
  inviteeFcId: string;
  inviteeName: string;
  inviteePhone: string;
  inviteeAffiliation: string;
  legacyRecommenderName: string;
  candidateCount: number;
  candidatePreview: string[];
  candidateOptions: RecommenderCandidate[];
  autoResolvableCandidate: RecommenderCandidate | null;
  matchStatus: 'ambiguous' | 'missing_candidate' | 'auto_resolvable' | 'self_referral';
};

export type ReferralAdminPermissions = {
  canMutate: boolean;
};

export type ReferralAdminListResponse = {
  ok: true;
  summary: ReferralAdminSummary;
  items: ReferralAdminListItem[];
  detail: ReferralAdminDetail | null;
  unresolvedItems: ReferralAdminUnresolvedItem[];
  permissions: ReferralAdminPermissions;
  page: number;
  pageSize: number;
  total: number;
};

export type ReferralAdminMutationAction =
  | 'backfill_missing_codes'
  | 'rotate_code'
  | 'disable_code'
  | 'link_legacy_recommender'
  | 'clear_legacy_recommender'
  | 'auto_resolve_legacy_recommenders';

export type ReferralAdminMutationRequest =
  | {
      action: 'backfill_missing_codes';
      payload?: {
        limit?: number;
      };
    }
  | {
      action: 'rotate_code' | 'disable_code';
      payload: {
        fcId: string;
        reason: string;
      };
    }
  | {
      action: 'link_legacy_recommender';
      payload: {
        inviteeFcId: string;
        inviterFcId: string;
        reason: string;
      };
    }
  | {
      action: 'clear_legacy_recommender';
      payload: {
        inviteeFcId: string;
        reason: string;
      };
    }
  | {
      action: 'auto_resolve_legacy_recommenders';
      payload?: {
        limit?: number;
        reason?: string;
      };
    };

export type ReferralAdminMutationResult = {
  ok?: boolean;
  changed?: boolean;
  action?: string;
  fcId?: string;
  previousCodeId?: string | null;
  previousCode?: string | null;
  codeId?: string | null;
  code?: string | null;
  eventType?: string | null;
  processed?: number;
  created?: number;
  linked?: number;
  skipped?: number;
  failed?: number;
  remaining?: number;
  limit?: number;
  inviteeFcId?: string;
  inviterFcId?: string | null;
  recommenderName?: string | null;
  referralCode?: string | null;
  [key: string]: unknown;
};

export type ReferralAdminMutationResponse = {
  ok: true;
  action: ReferralAdminMutationAction;
  result: ReferralAdminMutationResult;
};

export type RecommenderSelectionResult = {
  changed: boolean;
  inviteeFcId: string;
  inviterFcId: string | null;
  recommenderName: string | null;
  referralCode: string | null;
};

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

const isNonNegativeSafeInteger = (value: unknown): value is number => (
  Number.isSafeInteger(value) && Number(value) >= 0
);

function expectedReferralMutationLimit(request: ReferralAdminMutationRequest): number {
  const rawLimit = request.payload && 'limit' in request.payload ? request.payload.limit : undefined;
  if (typeof rawLimit !== 'number' || !Number.isFinite(rawLimit) || rawLimit <= 0) return 100;
  return Math.min(Math.max(Math.trunc(rawLimit), 1), 100);
}

export function isRecommenderSelectionResult(
  value: unknown,
  expected: { inviteeFcId: string; inviterFcId: string | null },
): value is RecommenderSelectionResult {
  if (!isRecord(value)
    || typeof value.changed !== 'boolean'
    || value.inviteeFcId !== expected.inviteeFcId
    || value.inviterFcId !== expected.inviterFcId
    || !isNullableString(value.recommenderName)
    || !isNullableString(value.referralCode)) return false;

  return expected.inviterFcId === null
    ? value.recommenderName === null && value.referralCode === null
    : isNonEmptyString(value.recommenderName) && isNonEmptyString(value.referralCode);
}

export function isReferralAdminMutationResponse(
  value: unknown,
  request: ReferralAdminMutationRequest,
): value is ReferralAdminMutationResponse {
  if (!isRecord(value) || value.ok !== true || value.action !== request.action || !isRecord(value.result)) {
    return false;
  }

  const result = value.result;
  if (request.action === 'rotate_code') {
    return result.ok === true
      && result.changed === true
      && result.action === 'rotated'
      && result.fcId === request.payload.fcId
      && isNullableString(result.previousCodeId)
      && isNullableString(result.previousCode)
      && isNonEmptyString(result.codeId)
      && isNonEmptyString(result.code)
      && result.eventType === 'code_rotated';
  }

  if (request.action === 'disable_code') {
    return result.ok === true
      && result.changed === true
      && result.action === 'disabled'
      && result.fcId === request.payload.fcId
      && isNonEmptyString(result.previousCodeId)
      && isNonEmptyString(result.previousCode)
      && result.codeId === null
      && result.code === null
      && result.eventType === 'code_disabled';
  }

  if (request.action === 'link_legacy_recommender') {
    return isRecommenderSelectionResult(result, {
      inviteeFcId: request.payload.inviteeFcId,
      inviterFcId: request.payload.inviterFcId,
    });
  }

  if (request.action === 'clear_legacy_recommender') {
    return isRecommenderSelectionResult(result, {
      inviteeFcId: request.payload.inviteeFcId,
      inviterFcId: null,
    });
  }

  const expectedLimit = expectedReferralMutationLimit(request);
  if (request.action === 'backfill_missing_codes') {
    return result.ok === true
      && isNonNegativeSafeInteger(result.processed)
      && isNonNegativeSafeInteger(result.created)
      && isNonNegativeSafeInteger(result.skipped)
      && isNonNegativeSafeInteger(result.remaining)
      && result.limit === expectedLimit
      && result.processed === result.created + result.skipped
      && result.processed <= result.limit;
  }

  return isNonNegativeSafeInteger(result.processed)
    && isNonNegativeSafeInteger(result.linked)
    && isNonNegativeSafeInteger(result.skipped)
    && isNonNegativeSafeInteger(result.failed)
    && isNonNegativeSafeInteger(result.remaining)
    && result.limit === expectedLimit
    && result.processed === result.linked + result.skipped + result.failed
    && result.processed <= result.limit;
}
