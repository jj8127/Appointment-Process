import {
  buildReferralInviteUrl,
  buildReferralShareText,
} from '../referral-share';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

  it('keeps the settings screen on the shared invite share copy', () => {
    const settingsSource = readFileSync(join(process.cwd(), 'app/settings.tsx'), 'utf8');

    expect(settingsSource).toContain('buildReferralShareText');
    expect(settingsSource).not.toContain('가람in 앱 가입 시 추천 코드를 입력해주세요!');
    expect(settingsSource).not.toContain('앱 열기 링크: hanwhafcpass://signup?code=');
  });
});
