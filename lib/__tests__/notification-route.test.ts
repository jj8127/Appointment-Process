import {
  normalizeNotificationTargetUrl,
  resolvePushNotificationRoute,
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

  it('normalizes board detail URLs to the board modal entry route', () => {
    expect(normalizeNotificationTargetUrl('/board?postId=post-123')).toBe(
      '/board?postId=post-123',
    );
    expect(normalizeNotificationTargetUrl('/board-detail?postId=post-123')).toBe(
      '/board?postId=post-123',
    );
    expect(normalizeNotificationTargetUrl('/dashboard/board?postId=post-123')).toBe(
      '/board?postId=post-123',
    );
    expect(normalizeNotificationTargetUrl('https://admin.example.com/dashboard/board?postId=post-123')).toBe(
      '/board?postId=post-123',
    );
  });

  it('routes push notification taps for board posts to the board modal entry route', () => {
    expect(resolvePushNotificationRoute({
      title: '새 게시글',
      body: '보험소식 브리핑',
      data: {
        type: 'board_post',
        url: 'https://admin.example.com/dashboard/board?postId=post-123',
      },
    })).toBe('/board?postId=post-123');

    expect(resolvePushNotificationRoute({
      title: '새 게시글',
      body: '보험소식 브리핑',
      data: {
        type: 'board_post',
        url: '/board-detail?postId=post-456',
      },
    })).toBe('/board?postId=post-456');
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
