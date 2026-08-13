type UnknownRecord = Record<string, unknown>;

export type FcNotificationResult =
  | { ok: true; sent: number }
  | {
      ok: false;
      reason: 'http_error' | 'invalid_response' | 'downstream_error' | 'not_logged' | 'no_device_target';
    };

export type AdminChatNotificationResult = FcNotificationResult;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

export function classifyFcNotificationResult(
  responseStatus: number,
  responseBody: unknown,
): FcNotificationResult {
  if (responseStatus < 200 || responseStatus >= 300) {
    return { ok: false, reason: 'http_error' };
  }

  const proxyEnvelope = asRecord(responseBody);
  if (!proxyEnvelope || proxyEnvelope.ok !== true) {
    return { ok: false, reason: 'invalid_response' };
  }

  const downstream = asRecord(proxyEnvelope.data);
  if (!downstream || downstream.ok !== true) {
    return { ok: false, reason: 'downstream_error' };
  }
  if (downstream.logged !== true) {
    return { ok: false, reason: 'not_logged' };
  }

  const sent = typeof downstream.sent === 'number' && Number.isFinite(downstream.sent)
    ? Math.max(0, Math.trunc(downstream.sent))
    : 0;
  if (sent < 1) {
    return { ok: false, reason: 'no_device_target' };
  }

  return { ok: true, sent };
}

// Keep the dashboard chat import stable while sharing the same strict contract
// with every browser caller of the FC notification proxy.
export const classifyAdminChatNotificationResult = classifyFcNotificationResult;
