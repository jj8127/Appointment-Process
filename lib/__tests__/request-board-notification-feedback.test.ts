import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getRequestBoardNotificationFeedback } from '../request-board-notification-feedback';

jest.mock('../request-board-url', () => ({ getRequestBoardApiBaseUrl: () => 'https://request-board.test' }));
jest.mock('../safe-storage', () => ({ safeStorage: {} }));
jest.mock('../secure-token-storage', () => ({ sensitiveTokenStorage: {} }));
jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../logger', () => ({ logger: { warn: jest.fn() } }));

describe('Request Board notification feedback', () => {
  it('returns a fixed post-commit warning for incomplete delivery', () => {
    expect(getRequestBoardNotificationFeedback({
      warning: 'notification_delivery_incomplete',
      notificationDelivery: {
        confirmed: false,
        sent: 0,
        attempted: 0,
        rejected: 0,
      },
    })).toEqual({ title: '처리 완료 · 알림 확인 필요', message: '요청 처리는 완료했습니다. 알림 전달이 확인되지 않았으므로 목록의 처리 상태를 확인해 주세요.' });
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

  it('keeps Request Board lifecycle screens on the shared post-commit warning contract', () => {
    const root = join(__dirname, '..', '..');
    const boardSource = readFileSync(join(root, 'app', 'request-board.tsx'), 'utf8');
    const reviewSource = readFileSync(join(root, 'app', 'request-board-review.tsx'), 'utf8');

    expect(boardSource).toContain('getRequestBoardNotificationFeedback(result)');
    expect(reviewSource.match(/getRequestBoardNotificationFeedback\(res\)/g)?.length).toBeGreaterThanOrEqual(5);
    const helperSource = readFileSync(join(root, 'lib', 'request-board-notification-feedback.ts'), 'utf8');
    expect(helperSource).toContain("logger.warn('[request-board] notification delivery unconfirmed'");
    expect(helperSource).toContain('hasIncompleteRequestBoardNotification');
  });
});
