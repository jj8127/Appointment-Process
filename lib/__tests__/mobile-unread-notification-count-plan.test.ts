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
      includeRequestBoardFcInbox: false,
      includeNoticeUnread: false,
      onlyRequestBoardCategories: false,
    });

    expect(
      resolveMobileUnreadBridgePlan({
        role: null,
        requestBoardRole: 'fc',
      }),
    ).toEqual({
      shouldFetch: false,
      includeLiveRequestBoardUnread: false,
      includeRequestBoardFcInbox: false,
      includeNoticeUnread: false,
      onlyRequestBoardCategories: false,
    });
  });

  it('uses fc-notify as the single count source for visible inbox items', () => {
    expect(
      resolveMobileUnreadBridgePlan({
        role: 'fc',
        requestBoardRole: null,
      }),
    ).toEqual({
      shouldFetch: true,
      includeLiveRequestBoardUnread: false,
      includeRequestBoardFcInbox: false,
      includeNoticeUnread: true,
      onlyRequestBoardCategories: false,
    });

    expect(
      resolveMobileUnreadBridgePlan({
        role: 'admin',
        requestBoardRole: 'fc',
      }),
    ).toEqual({
      shouldFetch: true,
      includeLiveRequestBoardUnread: false,
      includeRequestBoardFcInbox: true,
      includeNoticeUnread: true,
      onlyRequestBoardCategories: false,
    });

    expect(
      resolveMobileUnreadBridgePlan({
        role: 'admin',
        requestBoardRole: 'designer',
      }),
    ).toEqual({
      shouldFetch: true,
      includeLiveRequestBoardUnread: false,
      includeRequestBoardFcInbox: true,
      includeNoticeUnread: false,
      onlyRequestBoardCategories: true,
    });
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
      includeRequestBoardFcInbox: false,
      includeNoticeUnread: true,
      onlyRequestBoardCategories: false,
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
        includeRequestBoardFcInbox: true,
        includeNoticeUnread: false,
        onlyRequestBoardCategories: false,
      }),
    ).toEqual({
      type: 'inbox_unread_count',
      role: 'admin',
      resident_id: null,
      since: '2026-05-30T00:00:00.000Z',
      exclude_request_board_categories: true,
      include_request_board_fc: true,
      include_notices: false,
      only_request_board_categories: false,
    });

    expect(
      buildMobileUnreadFcNotifyBody({
        role: 'fc',
        residentId: '01051078127',
        sinceIso: '2026-05-30T00:00:00.000Z',
        includeLiveRequestBoardUnread: false,
        includeRequestBoardFcInbox: false,
        includeNoticeUnread: true,
        onlyRequestBoardCategories: false,
      }),
    ).toEqual({
      type: 'inbox_unread_count',
      role: 'fc',
      resident_id: '01051078127',
      since: '2026-05-30T00:00:00.000Z',
      exclude_request_board_categories: false,
      include_request_board_fc: false,
      include_notices: true,
      only_request_board_categories: false,
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

  it('fetches checkpoint and fc-notify for FC sessions without adding hidden live request_board unread', async () => {
    const deps = makeUnreadDeps();

    await expect(
      fetchMobileUnreadNotificationCountWithDeps({
        role: 'fc',
        residentId: '01051078127',
        requestBoardRole: null,
      }, deps),
    ).resolves.toBe(3);

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
      exclude_request_board_categories: false,
      include_request_board_fc: false,
      include_notices: true,
      only_request_board_categories: false,
    });
    expect(deps.getRequestBoardUnreadCount).not.toHaveBeenCalled();
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
      include_request_board_fc: false,
      include_notices: true,
      only_request_board_categories: false,
    });
    expect(deps.getRequestBoardUnreadCount).not.toHaveBeenCalled();
  });

  it('asks fc-notify to include the bridged FC request-board inbox for admin bridge sessions', async () => {
    const deps = makeUnreadDeps({ invokeFcNotify: jest.fn(async () => ({ data: { ok: true, count: 5 }, error: null })) });

    await expect(
      fetchMobileUnreadNotificationCountWithDeps({
        role: 'admin',
        residentId: '01051078127',
        requestBoardRole: 'fc',
      }, deps),
    ).resolves.toBe(5);

    expect(deps.invokeFcNotify).toHaveBeenCalledWith({
      type: 'inbox_unread_count',
      role: 'admin',
      resident_id: '01051078127',
      since: '2026-05-30T00:00:00.000Z',
      exclude_request_board_categories: false,
      include_request_board_fc: true,
      include_notices: true,
      only_request_board_categories: false,
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

  it('returns zero and logs the current warning when designer fc-notify count fails', async () => {
    const deps = makeUnreadDeps({
      invokeFcNotify: jest.fn(async () => ({ data: null, error: new Error('designer inbox down') })),
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
      expect.objectContaining({ message: 'designer inbox down' }),
    );
  });

  it('includes the personal request-board FC inbox for manager-backed designer sessions', async () => {
    const deps = makeUnreadDeps({
      invokeFcNotify: jest.fn(async () => ({ data: { ok: true, count: 2 }, error: null })),
    });

    await expect(
      fetchMobileUnreadNotificationCountWithDeps({
        role: 'admin',
        residentId: '01051078127',
        requestBoardRole: 'designer',
      }, deps),
    ).resolves.toBe(2);

    expect(deps.invokeFcNotify).toHaveBeenCalledWith({
      type: 'inbox_unread_count',
      role: 'admin',
      resident_id: '01051078127',
      since: '2026-05-30T00:00:00.000Z',
      exclude_request_board_categories: false,
      include_request_board_fc: true,
      include_notices: false,
      only_request_board_categories: true,
    });
  });

  it('counts only visible request_board category notifications for request-board designer sessions', async () => {
    const deps = makeUnreadDeps({
      invokeFcNotify: jest.fn(async () => ({ data: { ok: true, count: 4 }, error: null })),
      getRequestBoardUnreadCount: jest.fn(async () => 99),
    });

    await expect(
      fetchMobileUnreadNotificationCountWithDeps({
        role: 'fc',
        residentId: '01051078127',
        requestBoardRole: 'designer',
      }, deps),
    ).resolves.toBe(4);

    expect(deps.invokeFcNotify).toHaveBeenCalledWith({
      type: 'inbox_unread_count',
      role: 'fc',
      resident_id: '01051078127',
      since: '2026-05-30T00:00:00.000Z',
      exclude_request_board_categories: false,
      include_request_board_fc: false,
      include_notices: false,
      only_request_board_categories: true,
    });
    expect(deps.getRequestBoardUnreadCount).not.toHaveBeenCalled();
  });
});
