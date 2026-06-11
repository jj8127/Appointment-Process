import {
  normalizeNotificationTargetUrl,
  resolveRequestBoardNotificationRoute,
} from '@/lib/notification-route';

describe('notification route helpers', () => {
  it('normalizes admin/web notification URLs to mobile routes', () => {
    expect(normalizeNotificationTargetUrl('https://garam.example.com/dashboard/chat')).toBe(
      '/messenger?channel=garam',
    );
    expect(normalizeNotificationTargetUrl('/request-board-messenger')).toBe(
      '/messenger?channel=request-board',
    );
  });

  it('normalizes legacy board modal URLs to the standalone board detail route', () => {
    expect(normalizeNotificationTargetUrl('/board?postId=post-123')).toBe(
      '/board-detail?postId=post-123',
    );
  });

  it('routes request-board messages to the request-board messenger', () => {
    expect(resolveRequestBoardNotificationRoute({
      category: 'request_board_message',
      targetUrl: '/notifications',
    })).toBe('/messenger?channel=request-board');
  });

  it('routes group chat messages to the group chat screen', () => {
    expect(resolveRequestBoardNotificationRoute({
      category: 'group_chat_message',
      targetUrl: '/notifications',
    })).toBe('/group-chat');
    expect(normalizeNotificationTargetUrl('/group-chat')).toBe('/group-chat');
  });

  it('honors concrete request-board target URLs instead of collapsing to the request-board home', () => {
    expect(resolveRequestBoardNotificationRoute({
      category: 'request_board_completed',
      targetUrl: '/request-board-review?id=42',
    })).toBe('/request-board-review?id=42');
  });

  it('routes request-board lifecycle categories to useful list filters when no concrete target exists', () => {
    expect(resolveRequestBoardNotificationRoute({ category: 'request_board_new_request' })).toBe(
      '/request-board-requests?filter=pending',
    );
    expect(resolveRequestBoardNotificationRoute({ category: 'request_board_completed' })).toBe(
      '/request-board-requests?filter=completed',
    );
  });
});
