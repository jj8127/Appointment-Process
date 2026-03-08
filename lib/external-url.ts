export const normalizeExternalUrl = (rawUrl: string) => {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

export const isHttpUrl = (url: string) => /^https?:\/\//i.test(url.trim());
