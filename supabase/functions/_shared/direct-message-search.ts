export const DIRECT_MESSAGE_SEARCH_DEFAULT_LIMIT = 50;
export const DIRECT_MESSAGE_SEARCH_MAX_LIMIT = 50;
export const DIRECT_MESSAGE_SEARCH_MAX_QUERY_CODE_POINTS = 100;
export const DIRECT_MESSAGE_SEARCH_MIN_QUERY_CODE_POINTS = 2;
export const DIRECT_MESSAGE_SEARCH_EXCERPT_CODE_POINTS = 240;

export function normalizeDirectMessageSearchQuery(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  return length >= DIRECT_MESSAGE_SEARCH_MIN_QUERY_CODE_POINTS
      && length <= DIRECT_MESSAGE_SEARCH_MAX_QUERY_CODE_POINTS
    ? normalized
    : null;
}

export function normalizeDirectMessageSearchLimit(value: unknown): number | null {
  if (value === undefined) return DIRECT_MESSAGE_SEARCH_DEFAULT_LIMIT;
  return typeof value === 'number'
      && Number.isSafeInteger(value)
      && value >= 1
      && value <= DIRECT_MESSAGE_SEARCH_MAX_LIMIT
    ? value
    : null;
}

/**
 * Postgres LIKE treats %, _ and the escape character as syntax. Escaping all
 * three keeps user input literal when it is wrapped in a server-owned `%...%`
 * search pattern.
 */
export function escapePostgrestLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function buildDirectMessageExcerpt(
  value: unknown,
  maxCodePoints = DIRECT_MESSAGE_SEARCH_EXCERPT_CODE_POINTS,
): string {
  const normalized = typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim()
    : '';
  if (!Number.isSafeInteger(maxCodePoints) || maxCodePoints < 1) return '';
  return Array.from(normalized).slice(0, maxCodePoints).join('');
}


