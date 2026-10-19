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
  if (selectedReferral) {
    return null;
  }

  if (!String(searchQuery ?? '').trim()) {
    return '추천인을 검색해 선택해주세요.';
  }

  return '추천인을 적용하려면 검색 결과에서 한 명을 선택해주세요.';
}

export function hasValidStoredSignupReferral(
  payload: Pick<StoredSignupReferral, 'recommender' | 'referralCode' | 'referralInviterFcId'>,
): boolean {
  const code = String(payload.referralCode ?? '').trim().toUpperCase();
  return (
    /^[A-Z0-9]{8}$/.test(code)
    && Boolean(String(payload.referralInviterFcId ?? '').trim())
    && Boolean(String(payload.recommender ?? '').trim())
  );
}
