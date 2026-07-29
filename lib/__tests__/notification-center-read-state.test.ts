import {
  collectVisibleUnreadNotificationIds,
  reconcileNotificationCenterReadState,
} from '../notification-center-read-state';

const notificationA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const notificationB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scope = {
  role: 'fc' as const,
  residentId: '01011112222',
  requestBoardRole: null,
};

function createDeps(overrides = {}) {
  return {
    markRead: jest.fn(async () => ({
      ok: true,
      authorized: true,
      state: 'read',
    })),
    advanceNoticeCheckpoint: jest.fn(async () => '2026-07-27T01:00:00.000Z'),
    fetchUnreadCount: jest.fn(async () => 0),
    syncBadge: jest.fn(async () => undefined),
    warn: jest.fn(),
    ...overrides,
  };
}

describe('notification center read state', () => {
  it('collects only unique visible unread UUID rows', () => {
    expect(collectVisibleUnreadNotificationIds([
      { rawId: notificationA, readAt: null },
      { rawId: notificationA, readAt: null },
      { rawId: notificationB, readAt: '2026-07-27T00:00:00.000Z' },
      { rawId: 'not-a-uuid', readAt: null },
    ])).toEqual([notificationA]);
  });

  it('acknowledges visible rows, advances notices, then synchronizes the badge', async () => {
    const calls: string[] = [];
    const deps = createDeps({
      markRead: jest.fn(async () => {
        calls.push('mark');
        return { ok: true, authorized: true, state: 'read' };
      }),
      advanceNoticeCheckpoint: jest.fn(async () => {
        calls.push('checkpoint');
        return '2026-07-27T01:00:00.000Z';
      }),
      fetchUnreadCount: jest.fn(async () => {
        calls.push('count');
        return 2;
      }),
      syncBadge: jest.fn(async () => {
        calls.push('badge');
      }),
    });

    await expect(reconcileNotificationCenterReadState({
      scope,
      viewedAt: '2026-07-27T01:00:00.000Z',
      rows: [{ rawId: notificationA, readAt: null }],
    }, deps)).resolves.toEqual({
      requestedReadCount: 1,
      readAcknowledged: true,
      noticeCheckpointAdvanced: true,
      unreadCount: 2,
    });
    expect(calls).toEqual(['mark', 'checkpoint', 'count', 'badge']);
  });

  it('keeps failed notification acknowledgement retryable without blocking notice view state', async () => {
    const deps = createDeps({
      markRead: jest.fn(async () => ({
        ok: false,
        authorized: false,
        state: 'denied',
      })),
      fetchUnreadCount: jest.fn(async () => 1),
    });

    await expect(reconcileNotificationCenterReadState({
      scope,
      viewedAt: '2026-07-27T01:00:00.000Z',
      rows: [{ rawId: notificationA, readAt: null }],
    }, deps)).resolves.toMatchObject({
      requestedReadCount: 1,
      readAcknowledged: false,
      noticeCheckpointAdvanced: true,
      unreadCount: 1,
    });
    expect(deps.warn).toHaveBeenCalledWith(
      '[notifications] visible notification acknowledgement rejected',
      expect.any(Error),
    );
    expect(deps.syncBadge).toHaveBeenCalledWith(1);
  });

  it('does not issue an empty mark-read request', async () => {
    const deps = createDeps();
    await reconcileNotificationCenterReadState({
      scope,
      viewedAt: '2026-07-27T01:00:00.000Z',
      rows: [{ rawId: notificationA, readAt: '2026-07-27T00:00:00.000Z' }],
    }, deps);
    expect(deps.markRead).not.toHaveBeenCalled();
  });

  it('preserves the existing badge when authoritative unread refresh fails', async () => {
    const deps = createDeps({
      fetchUnreadCount: jest.fn(async () => {
        throw new Error('count unavailable');
      }),
    });

    await expect(reconcileNotificationCenterReadState({
      scope,
      viewedAt: '2026-07-27T01:00:00.000Z',
      rows: [{ rawId: notificationA, readAt: null }],
    }, deps)).resolves.toMatchObject({
      unreadCount: null,
    });

    expect(deps.syncBadge).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledWith(
      '[notifications] unread badge refresh failed',
      expect.objectContaining({ message: 'count unavailable' }),
    );
  });
});
