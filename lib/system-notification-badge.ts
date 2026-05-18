import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { logger } from './logger';

type SyncNativeNotificationBadgeOptions = {
  context?: string;
  dismissPresentedWhenZero?: boolean;
};

let lastAppliedBadgeCount: number | null = null;

export async function syncNativeNotificationBadge(
  unreadCount: number,
  options?: SyncNativeNotificationBadgeOptions,
) {
  if (Platform.OS === 'web') {
    return;
  }

  const context = options?.context ?? 'unknown';
  const normalizedCount = Number.isFinite(unreadCount) && unreadCount > 0
    ? Math.max(0, Math.floor(unreadCount))
    : 0;
  const shouldSetBadge = lastAppliedBadgeCount !== normalizedCount;

  if (!shouldSetBadge && (normalizedCount !== 0 || options?.dismissPresentedWhenZero === false)) {
    return;
  }

  if (shouldSetBadge) {
    try {
      await Notifications.setBadgeCountAsync(normalizedCount);
      lastAppliedBadgeCount = normalizedCount;
    } catch (error) {
      logger.debug('[notifications] setBadgeCountAsync failed', { context, error });
    }
  }

  if (normalizedCount === 0 && options?.dismissPresentedWhenZero !== false) {
    try {
      await Notifications.dismissAllNotificationsAsync();
    } catch (error) {
      logger.debug('[notifications] dismissAllNotificationsAsync failed', { context, error });
    }
  }
}
