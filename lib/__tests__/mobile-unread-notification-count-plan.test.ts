import {
  buildMobileUnreadFcNotifyBody,
  combineMobileUnreadCounts,
  fetchMobileUnreadNotificationCountWithDeps,
  resolveMobileUnreadBridgePlan,
} from '@/lib/mobile-unread-notification-count-plan';

const makeUnreadDeps = (overrides = {}) => ({
  getNotificationCheckpoint: jest.fn(async () => new Date('2026-05-30T00:00:00.000Z')),
  invokeFcNotify: jest.fn(async () => ({ data: { ok: true, count: 3 }, error: null })),
  getRequestBoardUnreadCount: jest.fn(async () => 4),
  warn: jest.fn(),
  ...overrides,
});

describe('resolveMobileUnreadBridgePlan', () => {
  it('short-circuits unidentified sessions before unread fetch work', () => {
    expect(
      resolveMobileUnreadBridgePlan({
        role: null,
        requestBoardRole: null,
      }),
    ).toEqual({
      shouldFetch: false,
      includeLiveRequestBoardUnread: false,
    });

    expect(
      resolveMobileUnreadBridgePlan({
        role: null,
        requestBoardRole: 'fc',
      }),
    ).toEqual({
      shouldFetch: false,
      includeLiveRequestBoardUnread: false,
    });
  });

  it('includes live request_board unread for FC and bridged request_board roles', () => {
    expect(
      resolveMobileUnreadBridgePlan({
        role: 'fc',
        requestBoardRole: null,
      }).includeLiveRequestBoardUnread,
    ).toBe(true);

    expect(
      resolveMobileUnreadBridgePlan({
        role: 'admin',
        requestBoardRole: 'fc',
      }).includeLiveRequestBoardUnread,
    ).toBe(true);

    expect(
      resolveMobileUnreadBridgePlan({
        role: 'admin',
        requestBoardRole: 'designer',
      }).includeLiveRequestBoardUnread,
    ).toBe(true);
  });

  it('keeps internal admin sessions on fc-onboarding unread only', () => {
    expect(
      resolveMobileUnreadBridgePlan({
        role: 'admin',
        requestBoardRole: null,
      }),
    ).toEqual({
      shouldFetch: true,
      includeLiveRequestBoardUnread: false,
    });
  });
});

describe('buildMobileUnreadFcNotifyBody', () => {
  it('keeps the current fc-notify unread count request shape', () => {
    expect(
      buildMobileUnreadFcNotifyBody({
        role: 'admin',
        residentId: undefined,
        sinceIso: '2026-05-30T00:00:00.000Z',
        includeLiveRequestBoardUnread: true,
      }),
    ).toEqual({
      type: 'inbox_unread_count',
      role: 'admin',
      resident_id: null,
      since: '2026-05-30T00:00:00.000Z',
      exclude_request_board_categories: true,
    });

    expect(
      buildMobileUnreadFcNotifyBody({
        role: 'fc',
        residentId: '01051078127',
        sinceIso: '2026-05-30T00:00:00.000Z',
        includeLiveRequestBoardUnread: false,
      }),
    ).toEqual({
      type: 'inbox_unread_count',
      role: 'fc',
      resident_id: '01051078127',
      since: '2026-05-30T00:00:00.000Z',
      exclude_request_board_categories: false,
    });
  });
});

describe('combineMobileUnreadCounts', () => {
  it('adds request_board unread only when live request_board unread is included', () => {
    expect(
      combineMobileUnreadCounts({
        fcNotifyCount: 3,
        requestBoardUnreadCount: 4,
        includeLiveRequestBoardUnread: true,
      }),
    ).toBe(7);

    expect(
      combineMobileUnreadCounts({
        fcNotifyCount: 3,
        requestBoardUnreadCount: 4,
        includeLiveRequestBoardUnread: false,
      }),
    ).toBe(3);
  });

  it('preserves current fc-notify count coercion fallback for missing counts', () => {
    expect(
      combineMobileUnreadCounts({
        fcNotifyCount: undefined,
        requestBoardUnreadCount: 4,
        includeLiveRequestBoardUnread: true,
      }),
    ).toBe(4);
  });
});

describe('fetchMobileUnreadNotificationCountWithDeps', () => {
  it('returns zero for unidentified sessions before any async fetch work', async () => {
    const deps = makeUnreadDeps();

    await expect(
      fetchMobileUnreadNotificationCountWithDeps({
        role: null,
        residentId: '01051078127',
        requestBoardRole: 'fc',
      }, deps),
    ).resolves.toBe(0);

    expect(deps.getNotificationCheckpoint).not.toHaveBeenCalled();
    expect(deps.invokeFcNotify).not.toHaveBeenCalled();
    expect(deps.getRequestBoardUnreadCount).not.toHaveBeenCalled();
    expect(deps.warn).not.toHaveBeenCalled();
  });

  it('fetches checkpoint, fc-notify, and live request_board unread for FC sessions', async () => {
    const deps = makeUnreadDeps();

    await expect(
      fetchMobileUnreadNotificationCountWithDeps({
        role: 'fc',
        residentId: '01051078127',
        requestBoardRole: null,
      }, deps),
    ).resolves.toBe(7);

    expect(deps.getNotificationCheckpoint).toHaveBeenCalledWith(
      {
        role: 'fc',
        residentId: '01051078127',
        requestBoardRole: null,
      },
      { initializeIfMissing: false },
    );
    expect(deps.invokeFcNotify).toHaveBeenCalledWith({
      type: 'inbox_unread_count',
      role: 'fc',
      resident_id: '01051078127',
      since: '2026-05-30T00:00:00.000Z',
      exclude_request_board_categories: true,
    });
    expect(deps.getRequestBoardUnreadCount).toHaveBeenCalledTimes(1);
    expect(deps.warn).not.toHaveBeenCalled();
  });

  it('skips live request_board unread for internal admin sessions without bridge role', async () => {
    const deps = makeUnreadDeps();

    await expect(
      fetchMobileUnreadNotificationCountWithDeps({
        role: 'admin',
        residentId: null,
        requestBoardRole: null,
      }, deps),
    ).resolves.toBe(3);

    expect(deps.invokeFcNotify).toHaveBeenCalledWith({
      type: 'inbox_unread_count',
      role: 'admin',
      resident_id: null,
      since: '2026-05-30T00:00:00.000Z',
      exclude_request_board_categories: false,
    });
    expect(deps.getRequestBoardUnreadCount).not.toHaveBeenCalled();
  });

  it('returns zero and logs the current warning when fc-notify is unavailable', async () => {
    const deps = makeUnreadDeps({
      invokeFcNotify: jest.fn(async () => ({ data: null, error: new Error('fc-notify down') })),
    });

    await expect(
      fetchMobileUnreadNotificationCountWithDeps({
        role: 'fc',
        residentId: '01051078127',
        requestBoardRole: null,
      }, deps),
    ).resolves.toBe(0);

    expect(deps.getRequestBoardUnreadCount).not.toHaveBeenCalled();
    expect(deps.warn).toHaveBeenCalledWith(
      '[mobile-unread-count] fetch failed',
      expect.objectContaining({ message: 'fc-notify down' }),
    );
  });

  it('returns zero and logs the current warning when live request_board unread fails', async () => {
    const deps = makeUnreadDeps({
      getRequestBoardUnreadCount: jest.fn(async () => {
        throw new Error('request_board unread down');
      }),
    });

    await expect(
      fetchMobileUnreadNotificationCountWithDeps({
        role: 'admin',
        residentId: '01051078127',
        requestBoardRole: 'designer',
      }, deps),
    ).resolves.toBe(0);

    expect(deps.warn).toHaveBeenCalledWith(
      '[mobile-unread-count] fetch failed',
      expect.objectContaining({ message: 'request_board unread down' }),
    );
  });
});
