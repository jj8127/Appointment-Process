export function normalizeAdminTempId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  return value.trim() || null;
}

export function resolveAdminTempIdUpdate(currentValue: unknown, nextValue: unknown) {
  const currentTempId = normalizeAdminTempId(currentValue);
  const nextTempId = normalizeAdminTempId(nextValue);

  return {
    changed: currentTempId !== nextTempId,
    currentTempId,
    nextTempId,
  };
}
