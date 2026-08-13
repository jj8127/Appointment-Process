export type NotificationDeliveryState =
  | 'delivered'
  | 'no_registered_device'
  | 'provider_failed'
  | 'persistence_failed'
  | 'invalid_recipient';

export type NotificationDeliveryFeedback = {
  state: NotificationDeliveryState;
  severity: 'success' | 'info' | 'warning' | 'error';
  retryable: boolean;
  title: string;
  message: string;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;

const FEEDBACK: Record<NotificationDeliveryState, NotificationDeliveryFeedback> = {
  delivered: {
    state: 'delivered',
    severity: 'success',
    retryable: false,
    title: '알림 전달 완료',
    message: '알림함 저장과 푸시 전송이 완료되었습니다.',
  },
  no_registered_device: {
    state: 'no_registered_device',
    severity: 'success',
    retryable: false,
    title: '알림 전송 완료',
    message: '알림을 보냈습니다.',
  },
  provider_failed: {
    state: 'provider_failed',
    severity: 'success',
    retryable: false,
    title: '알림 전송 완료',
    message: '알림을 보냈습니다.',
  },
  persistence_failed: {
    state: 'persistence_failed',
    severity: 'warning',
    retryable: true,
    title: '저장 완료 · 알림함 등록 실패',
    message: '요청은 처리됐지만 수신자 알림함에 등록하지 못했습니다.',
  },
  invalid_recipient: {
    state: 'invalid_recipient',
    severity: 'error',
    retryable: false,
    title: '저장 완료 · 수신자 확인 필요',
    message: '내용은 저장되었지만 유효한 알림 수신자를 확인할 수 없습니다.',
  },
};

export function getNotificationDeliveryFeedback(
  state: NotificationDeliveryState,
): NotificationDeliveryFeedback {
  return FEEDBACK[state];
}

/**
 * Parses both the canonical delivery result and the transitional Edge response.
 * The durable domain write (message, post, or exam round) is evaluated by its
 * caller; this helper classifies notification delivery only.
 */
export function parseNotificationDeliveryFeedback(
  value: unknown,
): NotificationDeliveryFeedback | null {
  const root = asRecord(value);
  if (!root) return null;

  const nested = asRecord(root.notification_delivery)
    ?? asRecord(root.notificationDelivery)
    ?? asRecord(root.notification)
    ?? asRecord(root.delivery)
    ?? root;

  const rawState = String(
    nested.state
      ?? nested.status
      ?? nested.pushStatus
      ?? nested.push_status
      ?? root.pushStatus
      ?? root.push_status
      ?? '',
  ).trim();
  if (rawState === 'invalid_recipient' || rawState === 'recipient_invalid') {
    return FEEDBACK.invalid_recipient;
  }

  const stored =
    nested.notificationStored
    ?? nested.notification_stored
    ?? nested.stored
    ?? nested.logged
    ?? root.notificationStored
    ?? root.notification_stored
    ?? root.stored
    ?? root.logged;
  if (stored === false) return FEEDBACK.persistence_failed;
  if (stored === true) {
    if (rawState === 'no_registered_device' || rawState === 'no_target') {
      return FEEDBACK.no_registered_device;
    }
    if (rawState === 'provider_failed' || rawState === 'push_failed' || rawState === 'provider_rejected') {
      return FEEDBACK.provider_failed;
    }
    return FEEDBACK.delivered;
  }

  if (
    rawState === 'delivered'
    || rawState === 'queued'
    || rawState === 'success'
  ) {
    return FEEDBACK.delivered;
  }
  if (rawState === 'no_registered_device' || rawState === 'no_target') {
    return FEEDBACK.no_registered_device;
  }
  if (
    rawState === 'provider_failed'
    || rawState === 'push_failed'
    || rawState === 'provider_rejected'
  ) {
    return FEEDBACK.provider_failed;
  }
  if (
    rawState === 'persistence_failed'
    || rawState === 'notification_insert_failed'
    || nested.stored === false
    || nested.logged === false
  ) {
    return FEEDBACK.persistence_failed;
  }
  return null;
}

export function notificationFeedbackColor(
  feedback: NotificationDeliveryFeedback,
): 'green' | 'blue' | 'yellow' | 'red' {
  if (feedback.severity === 'success') return 'green';
  if (feedback.severity === 'info') return 'blue';
  if (feedback.severity === 'warning') return 'yellow';
  return 'red';
}
