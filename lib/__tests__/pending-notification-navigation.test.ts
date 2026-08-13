import {
  buildPendingNotificationOwnerBinding,
  clearPendingNotificationNavigation,
  getPendingNotificationNavigation,
  pendingNotificationOwnerMatches,
  savePendingNotificationNavigation,
} from '../pending-notification-navigation';

jest.mock('../safe-storage', () => {
  const store = new Map<string, string>();
  return {
    safeStorage: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
    },
  };
});

const notificationA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const notificationB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const postA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const postB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const targetA = { version: 1, kind: 'board_post', postId: postA } as const;
const targetB = { version: 1, kind: 'board_post', postId: postB } as const;

describe('pending notification navigation atomic storage', () => {
  beforeEach(async () => {
    await clearPendingNotificationNavigation();
  });

  it('preserves newer B when conditional clear A is queued after capture B', async () => {
    await savePendingNotificationNavigation({
      notificationId: notificationA,
      target: targetA,
    });
    await Promise.all([
      savePendingNotificationNavigation({
        notificationId: notificationB,
        target: targetB,
      }),
      clearPendingNotificationNavigation({
        notificationId: notificationA,
        target: targetA,
      }),
    ]);

    await expect(getPendingNotificationNavigation()).resolves.toMatchObject({
      notificationId: notificationB,
      target: targetB,
    });
  });

  it('preserves newer B when capture B is queued after conditional clear A', async () => {
    await savePendingNotificationNavigation({
      notificationId: notificationA,
      target: targetA,
    });
    await Promise.all([
      clearPendingNotificationNavigation({
        notificationId: notificationA,
        target: targetA,
      }),
      savePendingNotificationNavigation({
        notificationId: notificationB,
        target: targetB,
      }),
    ]);

    await expect(getPendingNotificationNavigation()).resolves.toMatchObject({
      notificationId: notificationB,
      target: targetB,
    });
  });

  it('binds a pending target to account and session generation when known', () => {
    const ownerA = buildPendingNotificationOwnerBinding({
      role: 'fc',
      residentId: '010-1111-2222',
      appSessionToken: 'payload.signature-a',
    });
    const sameOwner = buildPendingNotificationOwnerBinding({
      role: 'fc',
      residentId: '01011112222',
      appSessionToken: 'payload.signature-a',
    });
    const switchedAccount = buildPendingNotificationOwnerBinding({
      role: 'fc',
      residentId: '01033334444',
      appSessionToken: 'payload.signature-b',
    });

    expect(pendingNotificationOwnerMatches(ownerA, sameOwner)).toBe(true);
    expect(pendingNotificationOwnerMatches(ownerA, switchedAccount)).toBe(false);
    expect(pendingNotificationOwnerMatches(ownerA, undefined)).toBe(false);
    expect(pendingNotificationOwnerMatches(undefined, switchedAccount)).toBe(false);
  });
});
