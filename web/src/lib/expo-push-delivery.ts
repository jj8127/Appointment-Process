export type ExpoPushDeliverySummary = Readonly<{
  attempted: number;
  accepted: number;
  rejected: number;
}>;

type ExpoPushTicket = Readonly<{
  status?: unknown;
}>;

function normalizeAttempted(attempted: number): number {
  if (!Number.isFinite(attempted) || attempted <= 0) return 0;
  return Math.trunc(attempted);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Classifies Expo push tickets without retaining provider responses, token
 * values, or other recipient-identifying data.
 */
export function classifyExpoPushDelivery(
  attempted: number,
  httpStatus: number,
  responseBody: unknown,
): ExpoPushDeliverySummary {
  const normalizedAttempted = normalizeAttempted(attempted);
  if (normalizedAttempted === 0) {
    return { attempted: 0, accepted: 0, rejected: 0 };
  }

  if (httpStatus < 200 || httpStatus >= 300 || !isRecord(responseBody)) {
    return { attempted: normalizedAttempted, accepted: 0, rejected: normalizedAttempted };
  }

  const tickets = responseBody.data;
  if (!Array.isArray(tickets)) {
    return { attempted: normalizedAttempted, accepted: 0, rejected: normalizedAttempted };
  }

  const accepted = tickets
    .slice(0, normalizedAttempted)
    .filter((ticket): ticket is ExpoPushTicket => isRecord(ticket))
    .filter((ticket) => ticket.status === 'ok')
    .length;

  return {
    attempted: normalizedAttempted,
    accepted,
    rejected: normalizedAttempted - accepted,
  };
}

/**
 * Returns the destination tokens whose ticket says the device is no longer
 * registered. Expo reports this permanently, so callers delete these tokens.
 * Mirrors supabase/functions/_shared/expo-push-delivery.ts.
 */
export function collectUnregisteredExpoTokens(
  messages: readonly Readonly<{ to?: unknown }>[],
  httpStatus: number,
  responseBody: unknown,
): string[] {
  if (httpStatus < 200 || httpStatus >= 300 || !isRecord(responseBody)) return [];
  const tickets = responseBody.data;
  if (!Array.isArray(tickets)) return [];

  const tokens = new Set<string>();
  tickets.slice(0, messages.length).forEach((ticket, index) => {
    const to = messages[index]?.to;
    if (
      isRecord(ticket)
      && ticket.status === 'error'
      && isRecord(ticket.details)
      && ticket.details.error === 'DeviceNotRegistered'
      && typeof to === 'string'
      && to.length > 0
    ) {
      tokens.add(to);
    }
  });
  return [...tokens];
}

export function mergeExpoPushDeliverySummaries(
  summaries: readonly ExpoPushDeliverySummary[],
): ExpoPushDeliverySummary {
  return summaries.reduce<ExpoPushDeliverySummary>(
    (total, summary) => ({
      attempted: total.attempted + summary.attempted,
      accepted: total.accepted + summary.accepted,
      rejected: total.rejected + summary.rejected,
    }),
    { attempted: 0, accepted: 0, rejected: 0 },
  );
}
