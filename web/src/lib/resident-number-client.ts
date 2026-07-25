function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readErrorMessage(payload: unknown): string {
  if (!isRecord(payload)) return '주민번호 조회 실패';
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  return '주민번호 조회 실패';
}

export class ResidentNumberReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResidentNumberReadError';
  }
}

export type ResidentNumberMap = Record<string, string | null>;

const isFullResidentNumber = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{6}-\d{7}$/.test(value);

export async function fetchResidentNumbersFull(
  fcIds: string[],
  signal?: AbortSignal,
): Promise<ResidentNumberMap> {
  const normalizedFcIds = Array.from(new Set(fcIds.map((fcId) => fcId.trim()).filter(Boolean)));
  if (normalizedFcIds.length > 20) {
    throw new ResidentNumberReadError('한 번에 최대 20명까지 조회할 수 있습니다.');
  }
  if (normalizedFcIds.length === 0) {
    return {};
  }

  const resp = await fetch('/api/admin/resident-numbers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    signal,
    body: JSON.stringify({ fcIds: normalizedFcIds }),
  });

  const json: unknown = await resp.json().catch(() => null);
  if (!resp.ok || !isRecord(json) || json.ok !== true || !isRecord(json.residentNumbers)) {
    throw new ResidentNumberReadError(readErrorMessage(json));
  }

  const residentNumbers = json.residentNumbers as Record<string, unknown>;
  return Object.fromEntries(
    normalizedFcIds.map((fcId) => {
      const value = residentNumbers[fcId];
      return [fcId, isFullResidentNumber(value) ? value : null];
    }),
  );
}

export async function fetchResidentNumberFull(fcId: string): Promise<string | null> {
  const residentNumbers = await fetchResidentNumbersFull([fcId]);
  const value = residentNumbers[fcId];
  if (value) return value;
  throw new ResidentNumberReadError('등록된 주민번호가 없습니다.');
}
