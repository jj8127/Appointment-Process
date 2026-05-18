const TRAILING_URL_PUNCTUATION = /[)\]}>,.!?:;'"”’]+$/u;

export const stripTrailingUrlPunctuation = (rawUrl: string) => rawUrl.trim().replace(TRAILING_URL_PUNCTUATION, '');

export const normalizeExternalUrl = (rawUrl: string) => {
  const trimmed = stripTrailingUrlPunctuation(rawUrl);
  if (!trimmed) return '';

  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

export const isHttpUrl = (url: string) => /^https?:\/\//i.test(url.trim());

export const formatExternalUrlDisplayText = (rawUrl: string, maxLength = 48) => {
  const normalized = normalizeExternalUrl(rawUrl);
  if (!normalized) return '';

  let displayText = normalized.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./i, '');
    const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
    const search = parsed.search ? '?...' : '';
    const hash = parsed.hash ? '#...' : '';
    displayText = `${host}${path}${search}${hash}`;
  } catch {
    // Keep the normalized fallback above for non-standard but openable URLs.
  }

  if (displayText.length <= maxLength) return displayText;

  const suffix = '...';
  return `${displayText.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`;
};
