const REFERRAL_CODE_QUERY_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export function normalizeReferralSearchQuery(query: string): string {
  return String(query ?? '').trim().toUpperCase();
}

export function isExactReferralCodeQuery(query: string): boolean {
  return REFERRAL_CODE_QUERY_PATTERN.test(normalizeReferralSearchQuery(query));
}
