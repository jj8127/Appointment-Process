import {
  buildReferralInviteUrl,
  buildReferralShareText,
} from '../referral-share';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { clearPendingReferralCodes, consumePendingReferralCode, normalizeReferralInviteCode, parseReferralInvite, savePendingReferralCode } from '../referral-deeplink';

jest.mock('@/lib/safe-storage', () => {
  const values = new Map<string, string>();
  return { safeStorage: {
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: jest.fn(async (key: string) => { values.delete(key); }),
  } };
});

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

  it('adds a care purpose without changing legacy FC invite links', () => {
    expect(buildReferralInviteUrl('abc123abcdef', undefined, 'care')).toBe('https://garam-invite.vercel.app/?code=ABC123ABCDEF&service=care');
    expect(buildReferralInviteUrl('abcdefgh')).toBe('https://garam-invite.vercel.app/?code=ABCDEFGH');
  });

  it('shares family-care copy with code fallback and honest installation guidance', () => {
    const text = buildReferralShareText({ code: 'abc123abcdef', service: 'care', appStoreUrl: 'https://apps.apple.com/app/id6756690846' });
    expect(text).toContain('모두온 가족간병');
    expect(text).toContain('추천 코드: ABC123ABCDEF');
    expect(text).toContain('https://garam-invite.vercel.app/?code=ABC123ABCDEF&service=care');
    expect(text).toContain('설치 후 이 초대 링크를 다시 열어주세요');
    expect(text).toContain('https://play.google.com/store/apps/details?id=com.jj8127.Garam_in');
    expect(text).toContain('iOS: https://apps.apple.com/app/id6756690846');
    expect(text).not.toContain('보험 위촉');
  });

  it('keeps the settings screen on the shared invite share copy', () => {
    const settingsSource = readFileSync(join(process.cwd(), 'app/settings.tsx'), 'utf8');

    expect(settingsSource).toContain('buildReferralShareText');
    expect(settingsSource).not.toContain('가람in 앱 가입 시 추천 코드를 입력해주세요!');
    expect(settingsSource).not.toContain('앱 열기 링크: hanwhafcpass://signup?code=');
  });
});

describe('purpose-bound referral deep links and recovery', () => {
  beforeEach(async () => { await clearPendingReferralCodes(); });

  it.each(['hanwhafcpass://signup?code=abcdefgh', 'hanwhafcpass:///signup?code=ABCDEFGH'])('accepts the existing FC URL form %s', url => {
    expect(parseReferralInvite(url)).toEqual({ code: 'ABCDEFGH' });
  });

  it.each(['hanwhafcpass://services/signup?service=care&code=abc123abcdef', 'hanwhafcpass:///services/signup?code=ABC123ABCDEF&service=care'])('keeps common signup purpose on %s', url => {
    expect(parseReferralInvite(url)).toEqual({ code: 'ABC123ABCDEF', service: 'care' });
  });

  it.each([
    null, '', 'https://evil.invalid/services/signup?service=care&code=ABC123ABCDEF',
    'hanwhafcpass://signup?service=care&code=ABCDEFGH',
    'hanwhafcpass://services/signup?service=insurance&code=ABC123ABCDEF',
    'hanwhafcpass://services/signup?code=ABC123ABCDEF',
    'hanwhafcpass://services/signup?service=care&service=care&code=ABC123ABCDEF',
    'hanwhafcpass://signup?code=ABCDEFGH&code=ABCDEFGH',
    'hanwhafcpass://signup?code=ABCDEFGH%3Cscript%3E',
    'hanwhafcpass://signup?code=%E0%A4%A',
    'hanwhafcpass://signup?code=short',
    'hanwhafcpass://evil@signup?code=ABCDEFGH',
  ])('ignores malformed or mismatched invite %s', url => {
    expect(parseReferralInvite(url)).toBeNull();
  });

  it('normalizes only valid FC or common codes and rejects arrays', () => {
    expect(normalizeReferralInviteCode(' abc123abcdef ')).toBe('ABC123ABCDEF');
    expect(normalizeReferralInviteCode(['ABCDEFGH'])).toBeNull();
    expect(normalizeReferralInviteCode('ABCD-EFGH')).toBeNull();
  });

  it('never lets a care invitation bleed into FC signup', async () => {
    await savePendingReferralCode('ABC123ABCDEF', 'care');
    expect(await consumePendingReferralCode()).toBeNull();
    expect(await consumePendingReferralCode('care')).toBe('ABC123ABCDEF');
    expect(await consumePendingReferralCode('care')).toBeNull();
  });

  it('does not consume FC recovery on the care screen', async () => {
    await savePendingReferralCode('ABCDEFGH');
    expect(await consumePendingReferralCode('care')).toBeNull();
    expect(await consumePendingReferralCode()).toBe('ABCDEFGH');
  });

  it('consumes an invitation only once under concurrent focus callbacks', async () => {
    await savePendingReferralCode('ABCDEFGH');
    expect(await Promise.all([consumePendingReferralCode(), consumePendingReferralCode()])).toEqual(['ABCDEFGH', null]);
  });

  it('clears both queued invitation purposes on account ownership changes', async () => {
    const save = savePendingReferralCode('ABC123ABCDEF', 'care');
    const clear = clearPendingReferralCodes();
    await Promise.all([save, clear]);
    expect(await consumePendingReferralCode('care')).toBeNull();
    expect(await consumePendingReferralCode()).toBeNull();
  });
});

describe('public invite landing purpose routing', () => {
  const html = readFileSync(join(process.cwd(), 'invite-page/index.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
  function landing(search: string, writeText = jest.fn(async (_value: string) => {}), userAgent = '') {
    const elements = new Map<string, { textContent: string; href: string; disabled: boolean; style: { display: string }; click?: () => Promise<void>; addEventListener: (event: string, callback: () => Promise<void>) => void }>();
    const document = { title: '', getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, {
        textContent: '', href: '', disabled: false, style: { display: 'none' },
        addEventListener(_event, callback) { this.click = callback; },
      });
      return elements.get(id)!;
    } };
    runInNewContext(script, {
      location: { search, href: `https://garam-invite.vercel.app/${search}` }, URLSearchParams, document,
      navigator: { clipboard: { writeText }, userAgent, platform: '', maxTouchPoints: 0 },
    });
    return { document, elements, writeText };
  }

  it('opens care common signup, exposes the code and explains installation recovery', async () => {
    const page = landing('?code=abc123abcdef&service=care');
    expect(page.elements.get('openApp')?.href).toBe('hanwhafcpass://services/signup?service=care&code=ABC123ABCDEF');
    expect(page.elements.get('codeVal')?.textContent).toBe('ABC123ABCDEF');
    expect(page.elements.get('careDescription')?.style.display).toBe('block');
    expect(page.elements.get('careInfo')?.style.display).toBe('flex');
    expect(page.elements.get('installHint')?.style.display).toBe('block');
    await page.elements.get('copyCode')?.click?.();
    expect(page.writeText).toHaveBeenCalledWith('ABC123ABCDEF');
    expect(page.elements.get('copyStatus')?.textContent).toBe('추천 코드를 복사했어요.');
  });

  it('keeps the existing FC route when no service is supplied', () => {
    expect(landing('?code=ABCDEFGH').elements.get('openApp')?.href).toBe('hanwhafcpass://signup?code=ABCDEFGH');
  });

  it('opens the app on Android, including the KakaoTalk in-app browser, through an intent URL with a store fallback', () => {
    const kakaoAndroid = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36;KAKAOTALK 2410520';
    expect(landing('?code=ABC123ABCDEF&service=care', undefined, kakaoAndroid).elements.get('openApp')?.href).toBe(
      'intent://services/signup?service=care&code=ABC123ABCDEF#Intent;scheme=hanwhafcpass;package=com.jj8127.Garam_in;'
      + 'S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.jj8127.Garam_in;end',
    );
  });

  it('reopens the invite in Safari from the iPhone KakaoTalk in-app browser before opening the app', () => {
    const kakaoIphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK 10.8.0';
    expect(landing('?code=ABCDEFGH', undefined, kakaoIphone).elements.get('openApp')?.href).toBe(
      'kakaotalk://web/openExternal?url=https%3A%2F%2Fgaram-invite.vercel.app%2F%3Fcode%3DABCDEFGH',
    );
  });

  it.each(['?code=%E0%A4%A&service=care', '?code=ABC123ABCDEF&service=unknown', '?code=ABCDEFGH&code=ABCDEFGH'])('shows a harmless invalid-link message for %s', search => {
    const page = landing(search);
    expect(page.elements.get('msg')?.textContent).toBe('유효하지 않은 링크입니다.');
    expect(page.elements.has('openApp')).toBe(false);
  });

  it('retains the visible code and gives manual instructions if clipboard access fails', async () => {
    const page = landing('?code=ABC123ABCDEF&service=care', jest.fn(async (_value: string): Promise<void> => { throw new Error('synthetic permission failure'); }));
    await page.elements.get('copyCode')?.click?.();
    expect(page.elements.get('codeVal')?.textContent).toBe('ABC123ABCDEF');
    expect(page.elements.get('copyStatus')?.textContent).toContain('직접 입력');
    expect(page.elements.get('copyCode')?.disabled).toBe(false);
  });
});
