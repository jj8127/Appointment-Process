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

export async function fetchResidentNumberFull(fcId: string): Promise<string | null> {
  const resp = await fetch('/api/admin/resident-numbers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ fcIds: [fcId] }),
  });

  const json: unknown = await resp.json().catch(() => null);
  if (!resp.ok || !isRecord(json) || json.ok !== true || !isRecord(json.residentNumbers)) {
    throw new ResidentNumberReadError(readErrorMessage(json));
  }

  const residentNumbers = json.residentNumbers as Record<string, unknown>;
  const value = residentNumbers[fcId];
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  throw new ResidentNumberReadError('등록된 주민번호가 없습니다.');
}
