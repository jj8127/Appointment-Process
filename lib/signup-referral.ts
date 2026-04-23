import type { ReferralSearchResult } from '@/components/ReferralSearchField';

type ReferralStatus = 'idle' | 'validating' | 'valid' | 'invalid';

type BuildStoredSignupReferralParams = {
  selectedReferral: ReferralSearchResult | null;
  referralStatus: ReferralStatus;
  referralInviterName: string;
  referralInviterFcId: string | null;
};

type StoredSignupReferral = {
  recommender: string;
  referralCode?: string;
  referralInviterFcId?: string;
};

type PendingReferralApplyState = {
  promise: Promise<void> | null;
};

export function buildStoredSignupReferral({
  selectedReferral,
  referralStatus,
  referralInviterName,
  referralInviterFcId,
}: BuildStoredSignupReferralParams): StoredSignupReferral {
  const normalizedCode = String(selectedReferral?.code ?? '').trim().toUpperCase();

  if (referralStatus !== 'valid' || !normalizedCode) {
    return { recommender: '' };
  }

  return {
    recommender: referralInviterName,
    referralCode: normalizedCode,
    referralInviterFcId: referralInviterFcId ?? undefined,
  };
}

export function getSignupReferralSelectionError(
  searchQuery: string,
  selectedReferral: ReferralSearchResult | null,
): string | null {
  if (!String(searchQuery ?? '').trim() || selectedReferral) {
    return null;
  }

  return '추천인을 적용하려면 검색 결과에서 한 명을 선택하거나 입력값을 지워주세요.';
}

export function runSinglePendingReferralApply(
  state: PendingReferralApplyState,
  start: () => Promise<void>,
): Promise<void> {
  if (state.promise) {
    return state.promise;
  }

  const promise = start().finally(() => {
    if (state.promise === promise) {
      state.promise = null;
    }
  });

  state.promise = promise;
  return promise;
}
