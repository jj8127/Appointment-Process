import { shouldStayInDaumPostcodeWebView } from '@/lib/daum-postcode';

describe('daum postcode webview guard', () => {
  it('keeps Kakao postcode web flows inside the in-app webview', () => {
    expect(shouldStayInDaumPostcodeWebView('https://postcode.map.daum.net/search')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('https://postcode.map.kakao.com/search')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('https://code.map.kakao.com/12345')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('https://search.map.daum.net/search')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js')).toBe(true);
  });

  it('keeps safe local transitions inside the webview', () => {
    expect(shouldStayInDaumPostcodeWebView('about:blank')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('javascript:void(0);')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('data:text/html;base64,AAAA')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('blob:https://postcode.map.kakao.com/1234')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView(undefined)).toBe(true);
  });

  it('only ejects non-web app schemes', () => {
    expect(shouldStayInDaumPostcodeWebView('https://example.com')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('https://accounts.google.com')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('https://accounts.kakao.com')).toBe(true);
    expect(shouldStayInDaumPostcodeWebView('kakaomap://look')).toBe(false);
    expect(shouldStayInDaumPostcodeWebView('mailto:test@example.com')).toBe(false);
    expect(shouldStayInDaumPostcodeWebView('tel:01012341234')).toBe(false);
  });
});
