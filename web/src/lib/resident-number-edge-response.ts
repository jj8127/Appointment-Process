import type {
  ResidentNumberReadResult,
  ResidentNumberReadStatus,
} from '@/lib/resident-number-read-contract';

type ResidentNumberEdgeFallbackResponse =
  | ({ ok: true } & ResidentNumberReadResult)
  | {
      ok: false;
      message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const isFullResidentNumber = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{6}-\d{7}$/.test(value);

export function parseResidentNumberEdgeFallbackResponse({
  responseOk,
  data,
}: {
  responseOk: boolean;
  data: unknown;
}): ResidentNumberEdgeFallbackResponse {
  if (
    responseOk &&
    isRecord(data) &&
    data.ok === true &&
    isRecord(data.residentNumbers)
  ) {
    const rawStatuses = isRecord(data.residentNumberStatuses)
      ? data.residentNumberStatuses
      : {};
    const residentNumbers: ResidentNumberReadResult['residentNumbers'] = {};
    const residentNumberStatuses: ResidentNumberReadResult['residentNumberStatuses'] = {};

    for (const [fcId, value] of Object.entries(data.residentNumbers)) {
      if (isFullResidentNumber(value)) {
        residentNumbers[fcId] = value;
        residentNumberStatuses[fcId] = 'ready';
        continue;
      }

      residentNumbers[fcId] = null;
      const declaredStatus = rawStatuses[fcId];
      const inferredStatus: ResidentNumberReadStatus = value === null
        ? 'missing'
        : 'unavailable';
      residentNumberStatuses[fcId] =
        declaredStatus === 'missing' || declaredStatus === 'unavailable'
          ? declaredStatus
          : inferredStatus;
    }

    return {
      ok: true,
      residentNumbers,
      residentNumberStatuses,
    };
  }

  let message = 'Edge Function failed';
  if (isRecord(data)) {
    if (typeof data.message === 'string') message = data.message;
    else if (typeof data.error === 'string') message = data.error;
  }

  return { ok: false, message };
}
