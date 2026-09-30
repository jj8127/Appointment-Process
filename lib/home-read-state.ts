export function formatHomeCount(value: number | undefined, isError: boolean, unit = '명'): string {
  if (isError) return '확인 불가';
  return value === undefined ? '조회 중' : `${value}${unit}`;
}

export function isReadSessionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { needsRelogin?: boolean; status?: number; code?: string };
  return value.needsRelogin === true || value.status === 401 || [
    'missing_app_session', 'invalid_app_session', 'expired_app_session', 'PGRST301', 'PGRST303',
  ].includes(value.code ?? '');
}
