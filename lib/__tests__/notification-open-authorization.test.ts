import { invokeFcNotify } from '../fc-notify-client';
import {
  authorizeNotificationOpen,
  parseNotificationOpenRoute,
} from '../notification-open-authorization';

jest.mock('../fc-notify-client', () => ({
  invokeFcNotify: jest.fn(),
}));

const notificationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const postId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherPostId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const target = { version: 1, kind: 'board_post', postId } as const;

describe('notification open authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires current-actor authorization and exact stored target equality', async () => {
    (invokeFcNotify as jest.Mock).mockResolvedValue({
      data: {
        ok: true,
        authorized: true,
        notification: { id: notificationId, target },
      },
      error: null,
    });
    await expect(
      authorizeNotificationOpen({ notificationId, target }),
    ).resolves.toEqual({ ok: true });
    expect(invokeFcNotify).toHaveBeenCalledWith({
      type: 'inbox_get',
      notification_id: notificationId,
    });

    (invokeFcNotify as jest.Mock).mockResolvedValue({
      data: {
        ok: true,
        authorized: true,
        notification: {
          id: notificationId,
          target: { ...target, postId: otherPostId },
        },
      },
      error: null,
    });
    await expect(
      authorizeNotificationOpen({ notificationId, target }),
    ).resolves.toEqual({ ok: false, reason: 'target_mismatch' });
  });

  it('rejects a response that does not explicitly authorize the viewer', async () => {
    (invokeFcNotify as jest.Mock).mockResolvedValue({
      data: {
        ok: true,
        notification: { id: notificationId, target },
      },
      error: null,
    });
    await expect(
      authorizeNotificationOpen({ notificationId, target }),
    ).resolves.toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('parses exactly one notification handoff through an identity-gate route', () => {
    const route =
      `/board?notificationId=${notificationId}`
      + `&notificationTarget=${encodeURIComponent(JSON.stringify(target))}`;
    expect(parseNotificationOpenRoute(route)).toEqual({
      notificationId,
      target,
    });
    expect(
      parseNotificationOpenRoute(
        `${route}&notificationId=${notificationId}`,
      ),
    ).toBeNull();
  });
});
