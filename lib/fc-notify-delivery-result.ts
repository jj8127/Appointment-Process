type UnknownRecord = Record<string, unknown>;

export type FcNotifyDeliveryResult =
  | { confirmed: true; sent: number }
  | {
      confirmed: false;
      reason:
        | 'transport_error'
        | 'invalid_response'
        | 'downstream_error'
        | 'not_logged'
        | 'no_device_target';
    };

export type FcNotifyTransportResult = {
  data?: unknown;
  error?: unknown;
};

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

export function classifyFcNotifyDeliveryResult(
  result: FcNotifyTransportResult | null | undefined,
): FcNotifyDeliveryResult {
  if (result?.error !== null && result?.error !== undefined) {
    return { confirmed: false, reason: 'transport_error' };
  }

  const data = asRecord(result?.data);
  if (!data) {
    return { confirmed: false, reason: 'invalid_response' };
  }
  if (data.ok !== true) {
    return { confirmed: false, reason: 'downstream_error' };
  }
  if (data.logged !== true) {
    return { confirmed: false, reason: 'not_logged' };
  }

  const sent = typeof data.sent === 'number' && Number.isFinite(data.sent)
    ? Math.max(0, Math.trunc(data.sent))
    : 0;
  if (sent < 1) {
    return { confirmed: false, reason: 'no_device_target' };
  }

  return { confirmed: true, sent };
}

export async function classifyFcNotifyDeliveryFromInvoke(
  invoke: () => Promise<FcNotifyTransportResult>,
): Promise<FcNotifyDeliveryResult> {
  try {
    return classifyFcNotifyDeliveryResult(await invoke());
  } catch {
    return { confirmed: false, reason: 'transport_error' };
  }
}
