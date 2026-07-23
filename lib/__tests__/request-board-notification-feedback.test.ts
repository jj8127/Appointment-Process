import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getRequestBoardNotificationFeedback } from '../request-board-notification-feedback';

describe('Request Board notification feedback', () => {
  it('logs incomplete delivery without returning user-facing feedback', () => {
    expect(getRequestBoardNotificationFeedback({
      warning: 'notification_delivery_incomplete',
      notificationDelivery: {
        confirmed: false,
        sent: 0,
        attempted: 0,
        rejected: 0,
      },
    })).toBeNull();
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

  it('keeps Request Board lifecycle screens compatible with hidden delivery diagnostics', () => {
    const root = join(__dirname, '..', '..');
    const boardSource = readFileSync(join(root, 'app', 'request-board.tsx'), 'utf8');
    const reviewSource = readFileSync(join(root, 'app', 'request-board-review.tsx'), 'utf8');

    expect(boardSource).toContain('getRequestBoardNotificationFeedback(result)');
    expect(reviewSource.match(/getRequestBoardNotificationFeedback\(res\)/g)?.length).toBeGreaterThanOrEqual(5);
    const helperSource = readFileSync(join(root, 'lib', 'request-board-notification-feedback.ts'), 'utf8');
    expect(helperSource).toContain("logger.warn('[request-board] notification delivery unconfirmed'");
    expect(helperSource).not.toContain('알림 확인 필요');
  });
});
