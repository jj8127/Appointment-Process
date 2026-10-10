import { normalizeReferralFunctionFailure } from '@/lib/referral-session-error';

describe('referral session error normalization', () => {
  it.each([
    'Failed to send a request to the Edge Function',
    'Failed to fetch',
    'Network request failed',
    'Load failed',
  ])('shows the feature-specific Korean fallback for transport failure: %s', (message) => {
    expect(normalizeReferralFunctionFailure({ message }, '추천 관계를 불러오지 못했습니다.')).toEqual({
      code: undefined,
      message: '추천 관계를 불러오지 못했습니다.',
      needsRelogin: false,
    });
  });

  it('treats legacy unauthorized auth messages as relogin-required', () => {
    const normalized = normalizeReferralFunctionFailure(
      { code: 'unauthorized', message: '인증이 필요합니다.' },
      '추천 관계를 불러오지 못했습니다.',
    );

    expect(normalized).toEqual({
      code: 'unauthorized',
      message: '추천인 기능을 사용하려면 다시 로그인해주세요.',
      needsRelogin: true,
    });
  });

  it('does not clear sessions from message-only auth-like failures', () => {
    const normalized = normalizeReferralFunctionFailure(
      { message: '인증이 필요합니다.' },
      '추천 관계를 불러오지 못했습니다.',
    );

    expect(normalized.code).toBeUndefined();
    expect(normalized.message).toBe('인증이 필요합니다.');
    expect(normalized.needsRelogin).toBe(false);
  });

  it('does not classify normal data errors as auth errors', () => {
    const normalized = normalizeReferralFunctionFailure(
      { code: 'db_error', message: '추천 관계를 찾을 수 없습니다.' },
      '추천 관계를 불러오지 못했습니다.',
    );

    expect(normalized.code).toBe('db_error');
    expect(normalized.message).toBe('추천 관계를 찾을 수 없습니다.');
    expect(normalized.needsRelogin).toBe(false);
  });
});
