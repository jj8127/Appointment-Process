import { shouldStayInDaumPostcodeWebView } from '@/lib/daum-postcode';

describe('daum postcode webview guard', () => {
  it('keeps Kakao postcode hosts inside the in-app webview', () => {
    expect(shouldStayInDaumPostcodeWebView('https://postcode.map.daum.net/search')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('https://code.map.kakao.com/12345')).toBe(true);
  });

  it('keeps local non-http transitions inside the webview', () => {
    expect(shouldStayInDaumPostcodeWebView('about:blank')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('javascript:void(0);')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView(undefined)).toBe(true);
  });

  it('blocks unrelated external hosts so they open outside the postcode view', () => {
    expect(shouldStayInDaumPostcodeWebView('https://example.com')).toBe(false);
    expect(shouldStayInDaumPostcodeWebView('https://accounts.google.com')).toBe(false);
  });
});
