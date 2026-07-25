import { invokeFcNotify } from '../fc-notify-client';
import {
  clearPendingNotificationNavigation,
  getPendingNotificationNavigation,
} from '../pending-notification-navigation';
import {
  markPendingNotificationRead,
  parseNotificationReceiptHandoff,
} from '../notification-receipt';

jest.mock('../fc-notify-client', () => ({
  invokeFcNotify: jest.fn(),
}));

jest.mock('../pending-notification-navigation', () => ({
  getPendingNotificationNavigation: jest.fn(),
  clearPendingNotificationNavigation: jest.fn(),
}));

const notificationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const postId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const target = { version: 1, kind: 'board_post', postId } as const;

describe('notification receipt v1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses only an exact typed handoff', () => {
    expect(
      parseNotificationReceiptHandoff({
        notificationId,
        notificationTarget: JSON.stringify(target),
      }),
    ).toEqual({ notificationId, target });
    expect(
      parseNotificationReceiptHandoff({
        notificationId,
        notificationTarget: JSON.stringify({ ...target, extra: true }),
      }),
    ).toBeNull();
    expect(
      parseNotificationReceiptHandoff({
        notificationId: [notificationId, notificationId],
        notificationTarget: JSON.stringify(target),
      }),
    ).toBeNull();
    expect(
      parseNotificationReceiptHandoff({
        notificationId,
        notificationTarget: [
          JSON.stringify(target),
          JSON.stringify(target),
        ],
      }),
    ).toBeNull();
    expect(
      parseNotificationReceiptHandoff({
        notificationId: [notificationId],
        notificationTarget: JSON.stringify(target),
      }),
    ).toBeNull();
    expect(
      parseNotificationReceiptHandoff({
        notificationId,
        notificationTarget: [JSON.stringify(target)],
      }),
    ).toBeNull();
  });

  it('does not mark when pending target does not match the loaded entity', async () => {
    (getPendingNotificationNavigation as jest.Mock).mockResolvedValue({
      version: 1,
      notificationId,
      target: { ...target, postId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      savedAt: new Date().toISOString(),
    });
    const result = await markPendingNotificationRead({
      handoff: { notificationId, target },
      expectedTarget: target,
    });
    expect(result).toEqual({ ok: false, reason: 'pending_mismatch' });
    expect(invokeFcNotify).not.toHaveBeenCalled();
  });

  it('marks exactly one receipt only after exact pending target validation', async () => {
    (getPendingNotificationNavigation as jest.Mock).mockResolvedValue({
      version: 1,
      notificationId,
      target,
      savedAt: new Date().toISOString(),
    });
    (invokeFcNotify as jest.Mock).mockResolvedValue({
      data: {
        ok: true,
        authorized: true,
        changed: true,
        state: 'read',
        updated: 1,
      },
      error: null,
    });
    (clearPendingNotificationNavigation as jest.Mock).mockResolvedValue(true);

    await expect(
      markPendingNotificationRead({
        handoff: { notificationId, target },
        expectedTarget: target,
      }),
    ).resolves.toEqual({ ok: true, state: 'read', updated: 1 });
    expect(invokeFcNotify).toHaveBeenCalledWith({
      type: 'inbox_mark_read',
      notification_ids: [notificationId],
    });
    expect(clearPendingNotificationNavigation).toHaveBeenCalledWith({
      notificationId,
      target,
    });
  });

  it('accepts an authorized already-read receipt idempotently', async () => {
    (getPendingNotificationNavigation as jest.Mock).mockResolvedValue({
      version: 1,
      notificationId,
      target,
      savedAt: new Date().toISOString(),
    });
    (invokeFcNotify as jest.Mock).mockResolvedValue({
      data: {
        ok: true,
        authorized: true,
        changed: false,
        state: 'already_read',
        updated: 0,
      },
      error: null,
    });
    (clearPendingNotificationNavigation as jest.Mock).mockResolvedValue(true);

    await expect(
      markPendingNotificationRead({
        handoff: { notificationId, target },
        expectedTarget: target,
      }),
    ).resolves.toEqual({
      ok: true,
      state: 'already_read',
      updated: 0,
    });
  });

  it('keeps the pending receipt when updated zero lacks authorization state', async () => {
    (getPendingNotificationNavigation as jest.Mock).mockResolvedValue({
      version: 1,
      notificationId,
      target,
      savedAt: new Date().toISOString(),
    });
    (invokeFcNotify as jest.Mock).mockResolvedValue({
      data: { ok: true, updated: 0 },
      error: null,
    });

    await expect(
      markPendingNotificationRead({
        handoff: { notificationId, target },
        expectedTarget: target,
      }),
    ).resolves.toEqual({ ok: false, reason: 'request_failed' });
    expect(clearPendingNotificationNavigation).not.toHaveBeenCalled();
  });
});
