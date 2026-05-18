import {
  isExactReferralCodeQuery,
  normalizeReferralSearchQuery,
} from '../referral-search';

describe('normalizeReferralSearchQuery', () => {
  test('trims whitespace and uppercases the query', () => {
    expect(normalizeReferralSearchQuery('  tuzd8m3a  ')).toBe('TUZD8M3A');
  });
});

describe('isExactReferralCodeQuery', () => {
  test('accepts a normalized 8-character referral code query', () => {
    expect(isExactReferralCodeQuery('tuzd8m3a')).toBe(true);
  });

  test('rejects non-code queries and confusing characters', () => {
    expect(isExactReferralCodeQuery('정준')).toBe(false);
    expect(isExactReferralCodeQuery('team one')).toBe(false);
    expect(isExactReferralCodeQuery('TOZD8M3A')).toBe(false);
    expect(isExactReferralCodeQuery('TUZD8M3')).toBe(false);
  });
});
