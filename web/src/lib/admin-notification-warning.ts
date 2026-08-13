type WarningResponse = {
  warning?: unknown;
  delivery?: unknown;
  notification?: unknown;
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;

const PERSISTENCE_WARNING_CODES = new Set([
  'notification_persistence_incomplete',
  'notification_persistence_and_delivery_incomplete',
  'notification_persistence_failed',
  'notification_inbox_persistence_failed',
]);

export function getAdminNotificationWarning(response: unknown): string | null {
  const root = asRecord(response);
  if (!root) return null;

  const typed = root as WarningResponse;
  const notification = asRecord(typed.notification);
  const delivery = asRecord(typed.delivery)
    ?? asRecord(notification?.delivery)
    ?? notification;
  if (delivery?.notificationStored === false) {
    return '요청은 처리됐지만 수신자 알림함에 등록하지 못했습니다.';
  }
  if (delivery?.notificationStored === true) return null;

  const warning = typeof typed.warning === 'string' ? typed.warning.trim() : '';
  if (PERSISTENCE_WARNING_CODES.has(warning)) {
    return '요청은 처리됐지만 수신자 알림함에 등록하지 못했습니다.';
  }
  return null;
}
