/** Preserve transport status without exposing an upstream response in the UI. */
export class QueryReadError extends Error {
  readonly status: number | undefined;

  constructor(status?: number) {
    super('자료를 불러오지 못했습니다.');
    this.name = 'QueryReadError';
    this.status = status;
  }
}

export function requiresQueryLogin(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: unknown; code?: unknown };
  return value.status === 401 || value.code === 'PGRST301' || value.code === 'PGRST303';
}
