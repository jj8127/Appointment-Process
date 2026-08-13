'use client';

import { notifications } from '@mantine/notifications';

import { getAdminNotificationWarning } from './admin-notification-warning';

export function showAdminNotificationWarning(response: unknown): boolean {
  const message = getAdminNotificationWarning(response);
  if (!message) return false;

  notifications.show({
    title: '알림함 등록 실패',
    message,
    color: 'yellow',
  });
  return true;
}
