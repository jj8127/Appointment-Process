const HTTP_URL_PREFIX = /^https?:\/\//i;
const SAFE_IN_WEBVIEW_PREFIXES = [/^about:/i, /^javascript:/i, /^data:/i, /^blob:/i];

export function shouldStayInDaumPostcodeWebView(url?: string | null): boolean {
  const trimmedUrl = (url ?? '').trim();

  if (!trimmedUrl) {
    return true;
  }

  if (SAFE_IN_WEBVIEW_PREFIXES.some((pattern) => pattern.test(trimmedUrl))) {
    return true;
  }

  // Kakao postcode can bounce across multiple HTTP(S) hosts on iOS.
  // If we eject any of them into Safari, the selection callback never returns
  // to React Native. Keep all web navigation inside this dedicated WebView and
  // only send non-web app schemes outside.
  return HTTP_URL_PREFIX.test(trimmedUrl);
}
