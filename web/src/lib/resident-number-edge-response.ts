type ResidentNumberMap = Record<string, string | null>;

type ResidentNumberEdgeFallbackResponse =
  | {
      ok: true;
      residentNumbers: ResidentNumberMap;
    }
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
    const residentNumbers = Object.fromEntries(
      Object.entries(data.residentNumbers).map(([fcId, value]) => [
        fcId,
        isFullResidentNumber(value) ? value : null,
      ]),
    );
    return {
      ok: true,
      residentNumbers,
    };
  }

  let message = 'Edge Function failed';
  if (isRecord(data)) {
    if (typeof data.message === 'string') message = data.message;
    else if (typeof data.error === 'string') message = data.error;
  }

  return { ok: false, message };
}
