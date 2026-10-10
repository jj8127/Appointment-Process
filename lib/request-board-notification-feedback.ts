import type { RbApiResult } from './request-board-api';
import { hasIncompleteRequestBoardNotification } from './request-board-api';
import { logger } from './logger';

export type RequestBoardNotificationFeedback = {
  title: string;
  message: string;
};

export function getRequestBoardNotificationFeedback(
  result: Pick<RbApiResult, 'warning' | 'notificationDelivery'>,
): RequestBoardNotificationFeedback | null {
  if (!hasIncompleteRequestBoardNotification(result)) return null;

  logger.warn('[request-board] notification delivery unconfirmed', {
    warning: result.warning ?? null,
    attempted: result.notificationDelivery?.attempted ?? null,
    rejected: result.notificationDelivery?.rejected ?? null,
  });
  return {
    title: '처리 완료 · 알림 확인 필요',
    message: '요청 처리는 완료했습니다. 알림 전달이 확인되지 않았으므로 목록의 처리 상태를 확인해 주세요.',
  };
}
