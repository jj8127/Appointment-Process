import fs from 'fs';
import path from 'path';

import {
  shouldEnableDaumPostcodeDebugUi,
  shouldStayInDaumPostcodeWebView,
} from '@/lib/daum-postcode';

describe('DaumPostcode source contract', () => {
  it('keeps debug UI off unless explicitly enabled', () => {
    expect(shouldEnableDaumPostcodeDebugUi()).toBe(false);
    expect(shouldEnableDaumPostcodeDebugUi('')).toBe(false);
    expect(shouldEnableDaumPostcodeDebugUi('0')).toBe(false);
    expect(shouldEnableDaumPostcodeDebugUi('false')).toBe(false);
    expect(shouldEnableDaumPostcodeDebugUi('1')).toBe(true);
    expect(shouldEnableDaumPostcodeDebugUi('true')).toBe(true);
  });

  it('does not show a modal debug alert when the postcode webview mounts', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components', 'DaumPostcode.tsx'),
      'utf8',
    );

    expect(source).not.toContain('postcode debug mounted');
    expect(source).not.toContain('DaumPostcode component rendered');
  });

  it('still keeps Kakao postcode web flows inside the in-app webview', () => {
    expect(shouldStayInDaumPostcodeWebView('https://postcode.map.daum.net/search')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('https://postcode.map.kakao.com/search')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('kakaomap://look')).toBe(false);
  });
});
