import type { RbApiResult } from './request-board-api';
import { logger } from './logger';

export type RequestBoardNotificationFeedback = {
  title: string;
  message: string;
};

export function getRequestBoardNotificationFeedback(
  result: Pick<RbApiResult, 'warning' | 'notificationDelivery'>,
): RequestBoardNotificationFeedback | null {
  const incomplete = result.warning === 'notification_delivery_incomplete'
    || result.notificationDelivery?.confirmed === false;
  if (!incomplete) return null;

  logger.warn('[request-board] notification delivery unconfirmed', {
    warning: result.warning ?? null,
    attempted: result.notificationDelivery?.attempted ?? null,
    rejected: result.notificationDelivery?.rejected ?? null,
  });
  return null;
}
