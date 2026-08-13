import { invokeFcNotify } from './fc-notify-client';
import { logger } from './logger';
import {
  fetchMobileUnreadNotificationCountWithDeps,
  fetchMobileUnreadNotificationCountWithDepsOrThrow,
  type MobileUnreadNotificationCountOptions,
} from './mobile-unread-notification-count-plan';
import { getNotificationNoticeCheckpoint } from './notification-notice-checkpoint';
import { rbGetNotificationUnreadCount } from './request-board-api';

async function withNoticeCheckpoint(
  options: MobileUnreadNotificationCountOptions,
): Promise<MobileUnreadNotificationCountOptions> {
  if (options.role === null || options.noticeSince) return options;

  const noticeSince = await getNotificationNoticeCheckpoint({
    role: options.role,
    residentId: options.residentId,
    requestBoardRole: options.requestBoardRole ?? null,
  });
  return { ...options, noticeSince };
}

export async function fetchMobileUnreadNotificationCount(
  options: MobileUnreadNotificationCountOptions,
): Promise<number> {
  const resolvedOptions = await withNoticeCheckpoint(options);
  return fetchMobileUnreadNotificationCountWithDeps(resolvedOptions, {
    invokeFcNotify: (body) => invokeFcNotify(body),
    getRequestBoardUnreadCount: rbGetNotificationUnreadCount,
    warn: (message, err) => logger.warn(message, err),
  });
}

export async function fetchMobileUnreadNotificationCountOrThrow(
  options: MobileUnreadNotificationCountOptions,
): Promise<number> {
  const resolvedOptions = await withNoticeCheckpoint(options);
  return fetchMobileUnreadNotificationCountWithDepsOrThrow(resolvedOptions, {
    invokeFcNotify: (body) => invokeFcNotify(body),
    getRequestBoardUnreadCount: rbGetNotificationUnreadCount,
    warn: (message, err) => logger.warn(message, err),
  });
}
