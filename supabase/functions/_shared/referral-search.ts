const REFERRAL_CODE_QUERY_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

export function normalizeReferralSearchQuery(query: string): string {
  return String(query ?? '').trim().toUpperCase();
}

export function isExactReferralCodeQuery(query: string): boolean {
  return REFERRAL_CODE_QUERY_PATTERN.test(normalizeReferralSearchQuery(query));
}

export function buildReferralNameSearchPattern(query: string): string {
  return `%${String(query ?? '').trim()}%`;
}

const normalizeNameSearchValue = (value?: string | null): string =>
  String(value ?? '').trim().toLocaleLowerCase('ko-KR');

export function isReferralNameSearchMatch(
  profile: { name?: string | null; affiliation?: string | null },
  query: string,
): boolean {
  const normalizedQuery = normalizeNameSearchValue(query);
  if (!normalizedQuery) {
    return false;
  }

  return normalizeNameSearchValue(profile.name).includes(normalizedQuery);
}
