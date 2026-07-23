import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getRequestBoardNotificationFeedback } from '../request-board-notification-feedback';

describe('Request Board notification feedback', () => {
  it('returns a partial-success message without treating the saved mutation as failed', () => {
    expect(getRequestBoardNotificationFeedback({
      warning: 'notification_delivery_incomplete',
      notificationDelivery: {
        confirmed: false,
        sent: 0,
        attempted: 0,
        rejected: 0,
      },
    })).toEqual({
      title: '처리 완료 · 알림 확인 필요',
      message: '요청은 정상 처리됐지만 상대방 알림 전달을 확인하지 못했습니다.',
    });
  });

  it('does not show a warning after confirmed delivery', () => {
    expect(getRequestBoardNotificationFeedback({
      notificationDelivery: {
        confirmed: true,
        sent: 1,
        attempted: 1,
        rejected: 0,
      },
    })).toBeNull();
  });

  it('surfaces partial delivery from both Request Board lifecycle screens', () => {
    const root = join(__dirname, '..', '..');
    const boardSource = readFileSync(join(root, 'app', 'request-board.tsx'), 'utf8');
    const reviewSource = readFileSync(join(root, 'app', 'request-board-review.tsx'), 'utf8');

    expect(boardSource).toContain('getRequestBoardNotificationFeedback(result)');
    expect(reviewSource.match(/getRequestBoardNotificationFeedback\(res\)/g)?.length).toBeGreaterThanOrEqual(5);
    expect(reviewSource).toContain('notificationFeedback?.message');
  });
});
