import {
  buildReferralInviteUrl,
  buildReferralShareText,
} from '../referral-share';

describe('referral share helpers', () => {
  it('uses the production invite landing page when env base url is missing', () => {
    expect(buildReferralInviteUrl('LTVZWTTW')).toBe('https://garam-invite.vercel.app/?code=LTVZWTTW');
  });

  it('builds share text with the invite landing link, not plain code fallback', () => {
    const text = buildReferralShareText({ code: 'ltvzwttw' });

    expect(text).toContain('아래 링크를 눌러 가입하세요');
    expect(text).toContain('https://garam-invite.vercel.app/?code=LTVZWTTW');
    expect(text).not.toContain('추천 코드: LTVZWTTW');
  });

  it('keeps custom base urls on the root path with code query', () => {
    expect(buildReferralInviteUrl('ABC123', 'https://example.com/')).toBe('https://example.com/?code=ABC123');
  });
});
