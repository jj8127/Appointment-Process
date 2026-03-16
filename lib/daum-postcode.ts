const TRUSTED_DAUM_POSTCODE_HOSTS = [
  /^postcode\.map\.daum\.net$/i,
  /^code\.map\.kakao\.com$/i,
];

const HTTP_URL_PREFIX = /^https?:\/\//i;

const extractHostname = (url: string): string | null => {
  const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
};

export function shouldStayInDaumPostcodeWebView(url?: string | null): boolean {
  const trimmedUrl = (url ?? '').trim();

  if (!trimmedUrl || trimmedUrl === 'about:blank' || !HTTP_URL_PREFIX.test(trimmedUrl)) {
    return true;
  }

  const hostname = extractHostname(trimmedUrl);
  if (!hostname) {
    return true;
  }

  return TRUSTED_DAUM_POSTCODE_HOSTS.some((pattern) => pattern.test(hostname));
}
