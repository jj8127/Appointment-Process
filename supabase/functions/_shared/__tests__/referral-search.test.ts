import {
  buildReferralNameSearchPattern,
  isExactReferralCodeQuery,
  isReferralNameSearchMatch,
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

describe('referral name search', () => {
  test('builds a name-only ilike pattern', () => {
    expect(buildReferralNameSearchPattern(' 서선미 ')).toBe('%서선미%');
  });

  test('matches the entered text against name only, not affiliation', () => {
    expect(isReferralNameSearchMatch({ name: '서선미', affiliation: '1본부 서선미' }, '서선미')).toBe(true);
    expect(isReferralNameSearchMatch({ name: '김가람', affiliation: '1본부 서선미' }, '서선미')).toBe(false);
  });
});
