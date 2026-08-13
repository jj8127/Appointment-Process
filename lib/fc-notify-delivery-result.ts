type UnknownRecord = Record<string, unknown>;

export type FcNotifyDeliveryResult =
  | {
      confirmed: true;
      notificationStored: true;
      sent: number;
      state:
        | 'stored_and_pushed'
        | 'stored_no_registered_device'
        | 'stored_push_unconfirmed';
    }
  | {
      confirmed: false;
      notificationStored: false | null;
      reason:
        | 'transport_error'
        | 'invalid_response'
        | 'persistence_failed'
        | 'invalid_recipient';
    };

export type FcNotifyTransportResult = {
  data?: unknown;
  error?: unknown;
};

export type FcNotifyDeliveryUiKind =
  | 'complete'
  | 'inbox_only'
  | 'retryable_failure'
  | 'invalid_recipient';

export function getFcNotifyDeliveryUiKind(
  result: FcNotifyDeliveryResult,
): FcNotifyDeliveryUiKind {
  if (result.confirmed) {
    return result.state === 'stored_no_registered_device'
      ? 'inbox_only'
      : 'complete';
  }
  if (result.reason === 'invalid_recipient') {
    return 'invalid_recipient';
  }
  return result.notificationStored === false
    ? 'retryable_failure'
    : 'complete';
}

export function combineFcNotifyDeliveryResults(
  results: readonly FcNotifyDeliveryResult[],
): FcNotifyDeliveryResult {
  const invalidRecipient = results.find(
    (result) => !result.confirmed && result.reason === 'invalid_recipient',
  );
  if (invalidRecipient) return invalidRecipient;

  const persistenceFailure = results.find(
    (result) => !result.confirmed && result.notificationStored === false,
  );
  if (persistenceFailure) return persistenceFailure;

  const unknown = results.find((result) => !result.confirmed);
  if (unknown) return unknown;

  return results[0] ?? {
    confirmed: false,
    notificationStored: null,
    reason: 'invalid_response',
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function asFiniteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function isInvalidRecipientReason(value: unknown): boolean {
  return value === 'invalid_recipient'
    || value === 'recipient_not_found'
    || value === 'inactive_recipient';
}

function classifyDeliveryMetadata(
  data: UnknownRecord,
): FcNotifyDeliveryResult | null {
  const nestedDelivery = asRecord(data.delivery);
  const metadata =
    (
      typeof nestedDelivery?.notificationStored === 'boolean'
      || typeof nestedDelivery?.notification_stored === 'boolean'
    )
      ? nestedDelivery
      : (
        typeof data.notificationStored === 'boolean'
        || typeof data.notification_stored === 'boolean'
      )
        ? data
        : null;
  if (!metadata) return null;

  const notificationStored =
    metadata.notificationStored ?? metadata.notification_stored;
  const reason = metadata.reason ?? data.reason;
  if (!notificationStored) {
    return {
      confirmed: false,
      notificationStored: false,
      reason: isInvalidRecipientReason(reason)
        ? 'invalid_recipient'
        : 'persistence_failed',
    };
  }

  const pushStatus =
    metadata.pushStatus
    ?? metadata.push_status
    ?? data.pushStatus
    ?? data.push_status;
  const sent = Math.max(
    asFiniteCount(data.sent),
    asFiniteCount(metadata.accepted),
  );
  if (pushStatus === 'accepted') {
    return {
      confirmed: true,
      notificationStored: true,
      sent,
      state: 'stored_and_pushed',
    };
  }
  if (pushStatus === 'no_registered_device') {
    return {
      confirmed: true,
      notificationStored: true,
      sent: 0,
      state: 'stored_no_registered_device',
    };
  }
  return {
    confirmed: true,
    notificationStored: true,
    sent,
    state: 'stored_push_unconfirmed',
  };
}

function classifyExplicitState(
  data: UnknownRecord,
): FcNotifyDeliveryResult | null {
  const state = data.delivery_status ?? data.deliveryStatus ?? data.state;
  const sent = asFiniteCount(data.sent);
  if (state === 'stored_and_pushed') {
    return {
      confirmed: true,
      notificationStored: true,
      sent,
      state,
    };
  }
  if (state === 'no_registered_device' || state === 'stored_no_registered_device') {
    return {
      confirmed: true,
      notificationStored: true,
      sent: 0,
      state: 'stored_no_registered_device',
    };
  }
  if (state === 'provider_failed') {
    return {
      confirmed: true,
      notificationStored: true,
      sent,
      state: 'stored_push_unconfirmed',
    };
  }
  if (state === 'persistence_failed') {
    return {
      confirmed: false,
      notificationStored: false,
      reason: 'persistence_failed',
    };
  }
  if (state === 'invalid_recipient') {
    return {
      confirmed: false,
      notificationStored: false,
      reason: 'invalid_recipient',
    };
  }
  return null;
}

export function classifyFcNotifyDeliveryResult(
  result: FcNotifyTransportResult | null | undefined,
): FcNotifyDeliveryResult {
  const data = asRecord(result?.data);
  const deliveryMetadata = data ? classifyDeliveryMetadata(data) : null;
  if (deliveryMetadata) return deliveryMetadata;

  if (result?.error !== null && result?.error !== undefined) {
    const error = asRecord(result.error);
    const context = asRecord(error?.context);
    const status = asFiniteCount(context?.status);
    const reason = error?.reason ?? error?.code;
    if (
      isInvalidRecipientReason(reason)
      || status === 404
      || status === 422
    ) {
      return {
        confirmed: false,
        notificationStored: false,
        reason: 'invalid_recipient',
      };
    }
    return {
      confirmed: false,
      notificationStored: null,
      reason: 'transport_error',
    };
  }

  if (!data) {
    return {
      confirmed: false,
      notificationStored: null,
      reason: 'invalid_response',
    };
  }
  const explicitState = classifyExplicitState(data);
  if (explicitState) return explicitState;
  if (isInvalidRecipientReason(data.reason)) {
    return {
      confirmed: false,
      notificationStored: false,
      reason: 'invalid_recipient',
    };
  }
  if (data.logged !== true) {
    return {
      confirmed: false,
      notificationStored: false,
      reason: 'persistence_failed',
    };
  }

  const delivery = asRecord(data.delivery);
  const webPush = asRecord(data.web_push);
  const sent = asFiniteCount(data.sent);
  const providerAccepted = Math.max(
    sent,
    asFiniteCount(delivery?.accepted),
    asFiniteCount(webPush?.sent),
  );
  if (providerAccepted > 0 && data.ok === true) {
    return {
      confirmed: true,
      notificationStored: true,
      sent: providerAccepted,
      state: 'stored_and_pushed',
    };
  }

  const providerAttempted =
    asFiniteCount(delivery?.attempted) > 0
    || asFiniteCount(webPush?.failed) > 0;
  const providerFailed =
    data.ok === false
    && (
      providerAttempted
      || data.warning !== null && data.warning !== undefined
      || data.reason === 'device_token_lookup_failed'
      || data.message === 'Device token lookup failed'
      || webPush?.ok === false && webPush?.noTarget !== true
    );
  if (providerFailed) {
    return {
      confirmed: true,
      notificationStored: true,
      sent: providerAccepted,
      state: 'stored_push_unconfirmed',
    };
  }

  if (
    providerAccepted === 0
    && !providerAttempted
    && (
      data.ok === true
      || data.ok === false
      || data.ok === undefined
    )
  ) {
    return {
      confirmed: true,
      notificationStored: true,
      sent: 0,
      state: 'stored_no_registered_device',
    };
  }

  return {
    confirmed: false,
    notificationStored: null,
    reason: 'invalid_response',
  };
}

export async function classifyFcNotifyDeliveryFromInvoke(
  invoke: () => Promise<FcNotifyTransportResult>,
): Promise<FcNotifyDeliveryResult> {
  try {
    return classifyFcNotifyDeliveryResult(await invoke());
  } catch {
    return {
      confirmed: false,
      notificationStored: null,
      reason: 'transport_error',
    };
  }
}
