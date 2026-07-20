export const ADMIN_WEB_LOGIN_UPSTREAM_TIMEOUT_MS = 15_000;
export const ADMIN_WEB_LOGIN_BROWSER_TIMEOUT_MS = 20_000;

function readNestedError(error: unknown, field: 'name' | 'cause' | 'context') {
  if (!error || typeof error !== 'object') return undefined;
  return (error as Record<string, unknown>)[field];
}

export function isAdminWebLoginTimeout(error: unknown) {
  let current: unknown = error;
  const visited = new Set<unknown>();

  for (let depth = 0; depth < 4 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    const name = readNestedError(current, 'name');
    if (name === 'AbortError' || name === 'TimeoutError') return true;
    current = readNestedError(current, 'context') ?? readNestedError(current, 'cause');
  }

  return false;
}
