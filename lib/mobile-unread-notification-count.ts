import { invokeFcNotify } from './fc-notify-client';
import { logger } from './logger';
import {
  fetchMobileUnreadNotificationCountWithDeps,
  type MobileUnreadNotificationCountOptions,
} from './mobile-unread-notification-count-plan';
import { getNotificationCheckpoint } from './notification-checkpoint';
import { rbGetNotificationUnreadCount } from './request-board-api';

export async function fetchMobileUnreadNotificationCount({
  role,
  residentId,
  requestBoardRole = null,
}: MobileUnreadNotificationCountOptions): Promise<number> {
  return fetchMobileUnreadNotificationCountWithDeps({
    role,
    residentId,
    requestBoardRole,
  }, {
    getNotificationCheckpoint,
    invokeFcNotify: (body) => invokeFcNotify(body),
    getRequestBoardUnreadCount: rbGetNotificationUnreadCount,
    warn: (message, err) => logger.warn(message, err),
  });
}
