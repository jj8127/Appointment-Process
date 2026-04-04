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
  skipped?: number;
  remaining?: number;
  limit?: number;
  [key: string]: unknown;
};

export type ReferralAdminMutationResponse = {
  ok: true;
  action: ReferralAdminMutationAction;
  result: ReferralAdminMutationResult;
};
