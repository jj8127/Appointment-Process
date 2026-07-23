export type PushDeliveryFailure =
  | 'missing_recipient'
  | 'inbox_write_failed'
  | 'token_query_failed'
  | 'expo_http_failed'
  | 'expo_invalid_response'
  | 'expo_ticket_rejected'
  | 'web_subscription_query_failed'
  | 'web_delivery_failed'
  | 'unexpected_failure';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function classifyExpoTickets(
  providerBody: unknown,
  attempted: number,
): { accepted: number; rejected: number; invalid: boolean } {
  const envelope = asRecord(providerBody);
  const tickets = envelope?.data;
  if (!Array.isArray(tickets)) {
    return { accepted: 0, rejected: attempted, invalid: true };
  }

  let accepted = 0;
  for (let index = 0; index < attempted; index += 1) {
    const ticket = asRecord(tickets[index]);
    if (ticket?.status === 'ok') {
      accepted += 1;
    }
  }

  return {
    accepted,
    rejected: attempted - accepted,
    invalid: tickets.length < attempted,
  };
}

export function classifyExpoResponse(
  httpOk: boolean,
  providerBody: unknown,
  attempted: number,
): { accepted: number; rejected: number; failures: PushDeliveryFailure[] } {
  if (!httpOk) {
    return {
      accepted: 0,
      rejected: attempted,
      failures: ['expo_http_failed'],
    };
  }

  const ticketResult = classifyExpoTickets(providerBody, attempted);
  const failures: PushDeliveryFailure[] = [];
  if (ticketResult.invalid) failures.push('expo_invalid_response');
  if (ticketResult.rejected > 0) failures.push('expo_ticket_rejected');

  return {
    accepted: ticketResult.accepted,
    rejected: ticketResult.rejected,
    failures,
  };
}

export function classifyDeliverySummary({
  failures,
  expoTargets,
  webTargets,
}: {
  failures: PushDeliveryFailure[];
  expoTargets: number;
  webTargets: number;
}): {
  success: boolean;
  warning: 'partial_failure' | 'no_target' | null;
  noTarget: boolean;
} {
  const targetStateUnknown = failures.some((failure) =>
    failure === 'token_query_failed' ||
    failure === 'web_subscription_query_failed' ||
    failure === 'unexpected_failure');
  const noTarget = !targetStateUnknown && expoTargets === 0 && webTargets === 0;
  const warning = failures.length > 0
    ? 'partial_failure'
    : noTarget
      ? 'no_target'
      : null;

  return {
    success: warning === null,
    warning,
    noTarget,
  };
}
