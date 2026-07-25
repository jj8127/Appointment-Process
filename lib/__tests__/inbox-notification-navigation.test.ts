import { prepareInboxNotificationNavigation } from '../inbox-notification-navigation';

jest.mock('../notification-open-authorization', () => ({
  authorizeNotificationOpen: jest.fn(),
}));

jest.mock('../pending-notification-navigation', () => ({
  savePendingNotificationNavigation: jest.fn(),
}));

const notificationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const postId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const target = { version: 1, kind: 'board_post', postId } as const;
const owner = {
  role: 'fc' as const,
  residentId: '01000000000',
  sessionFingerprint: 'session',
};

describe('notifications inbox navigation preflight', () => {
  it('authorizes the current exact row before storing an owner-bound pending route', async () => {
    const events: string[] = [];
    const authorize = jest.fn(async () => {
      events.push('authorize');
      return { ok: true as const };
    });
    const savePending = jest.fn(async (input) => {
      events.push('save');
      return {
        version: 1 as const,
        ...input,
        savedAt: new Date().toISOString(),
      };
    });

    const result = await prepareInboxNotificationNavigation(
      { notificationId, target, viewerRole: 'fc', owner },
      { authorize, savePending },
    );

    expect(events).toEqual(['authorize', 'save']);
    expect(savePending).toHaveBeenCalledWith({
      notificationId,
      target,
      owner,
    });
    expect(result).toEqual({
      ok: true,
      route: expect.stringContaining(`/board?postId=${postId}`),
    });
  });

  it('does not persist or navigate from a stale inbox-list row', async () => {
    const savePending = jest.fn();
    const result = await prepareInboxNotificationNavigation(
      { notificationId, target, viewerRole: 'fc', owner },
      {
        authorize: async () => ({ ok: false as const, reason: 'unauthorized' }),
        savePending,
      },
    );

    expect(result).toEqual({ ok: false, reason: 'unauthorized' });
    expect(savePending).not.toHaveBeenCalled();
  });

  it('rejects ownerless inbox taps before any authorization or storage', async () => {
    const authorize = jest.fn();
    const savePending = jest.fn();
    const result = await prepareInboxNotificationNavigation(
      { notificationId, target, viewerRole: 'fc', owner: undefined },
      { authorize, savePending },
    );

    expect(result).toEqual({ ok: false, reason: 'missing_owner' });
    expect(authorize).not.toHaveBeenCalled();
    expect(savePending).not.toHaveBeenCalled();
  });
});
