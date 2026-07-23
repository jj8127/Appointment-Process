export const ADMIN_NOTIFICATION_WARNING_TITLE = '처리 완료 · 알림 확인 필요';

export const ADMIN_NOTIFICATION_WARNING_MESSAGE =
  '변경사항은 저장되었지만 가람in 알림 전달을 확인하지 못했습니다.';

type WarningResponse = {
  warning?: unknown;
};

export function getAdminNotificationWarning(response: unknown): string | null {
  if (!response || typeof response !== 'object') {
    return null;
  }

  const warning = (response as WarningResponse).warning;
  return typeof warning === 'string' && warning.trim()
    ? ADMIN_NOTIFICATION_WARNING_MESSAGE
    : null;
}
