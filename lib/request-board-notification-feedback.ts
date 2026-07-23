import type { RbApiResult } from './request-board-api';

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

  return {
    title: '처리 완료 · 알림 확인 필요',
    message: '요청은 정상 처리됐지만 상대방 알림 전달을 확인하지 못했습니다.',
  };
}
