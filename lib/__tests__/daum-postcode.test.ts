import { readFileSync } from 'node:fs';
import vm from 'node:vm';
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


it('postcode bridge emits one safe script/timeout error and clears the timeout after readiness', () => {
  const source = readFileSync('components/DaumPostcode.tsx', 'utf8');
  const html = /const DAUM_POSTCODE_HTML = \x60([\s\S]*?)\x60;/m.exec(source)![1];
  const script = /<script type="text\/javascript">([\s\S]*?)<\/script>/.exec(html)![1];
  const scenario = (mode: string) => {
    const emitted: string[] = []; let timeout: (() => void) | null = null; const external: { onerror?: () => void; onload?: () => void } = {};
    const context = vm.createContext({
      window: { ReactNativeWebView: { postMessage: (message: string) => emitted.push(message) } },
      document: { getElementById: () => ({ innerHTML: '', style: {} }), createElement: () => external, getElementsByTagName: () => [{ parentNode: { insertBefore() {} } }] },
      setTimeout: (fn: () => void) => { timeout = fn; return 1; }, clearTimeout: () => { timeout = null; }, daum: { Postcode: function() { return { embed() {} }; } },
    });
    vm.runInContext(script, context); context.initOnReady({});
    if (mode === 'error') { external.onerror!(); external.onerror!(); }
    else if (mode === 'timeout') { (timeout as unknown as () => void)(); }
    else { external.onload!(); external.onload!(); expect(timeout).toBeNull(); }
    return emitted;
  };
  expect(scenario('error')).toEqual(['__postcode_state__:error']); expect(scenario('timeout')).toEqual(['__postcode_state__:error']); expect(scenario('ready')).toEqual(['__postcode_state__:ready']);
});
