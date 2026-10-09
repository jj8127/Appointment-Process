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
  if (root.cleanupWarning === true || root.cleanupPending === true) {
    return '주요 처리는 완료됐습니다. 일부 파일 정리가 남아 있습니다. 같은 작업을 다시 요청하지 마세요.';
  }
  if (root.pushWarning === true) return '업무 변경은 완료됐지만 후속 알림 전송을 확인하지 못했습니다. 업무 변경을 반복하지 마세요.';
  if (root.warning === 'workflow_update_incomplete') {
    return '요청은 저장됐지만 진행 상태 반영을 완료하지 못했습니다. 새로고침해 확인해주세요.';
  }

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
