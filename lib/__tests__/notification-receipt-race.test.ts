import { invokeFcNotify } from '../fc-notify-client';
import {
  hasPendingNotificationNavigationIntent,
  markNotificationNavigationPending,
  resetNotificationNavigationCoordinatorForTests,
  waitForNotificationNavigationDecision,
} from '../notification-navigation-coordinator';
import {
  clearPendingNotificationNavigation,
  getPendingNotificationNavigation,
  savePendingNotificationNavigation,
} from '../pending-notification-navigation';
import { markPendingNotificationRead } from '../notification-receipt';

jest.mock('../fc-notify-client', () => ({
  invokeFcNotify: jest.fn(),
}));

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
const targetA = {
  version: 1,
  kind: 'board_post',
  postId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
} as const;
const targetB = {
  version: 1,
  kind: 'board_post',
  postId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
} as const;

describe('notification receipt cleanup race', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetNotificationNavigationCoordinatorForTests();
    await clearPendingNotificationNavigation();
  });

  it('preserves newer B in storage and coordinator while mark-read A is awaiting', async () => {
    let releaseMarkRead: ((value: {
      data: {
        ok: true;
        authorized: true;
        state: 'read';
        updated: number;
      };
      error: null;
    }) => void) | undefined;
    let signalMarkReadStarted: (() => void) | undefined;
    const markReadStarted = new Promise<void>((resolve) => {
      signalMarkReadStarted = resolve;
    });
    const markReadResponse = new Promise<{
      data: {
        ok: true;
        authorized: true;
        state: 'read';
        updated: number;
      };
      error: null;
    }>((resolve) => {
      releaseMarkRead = resolve;
    });
    (invokeFcNotify as jest.Mock).mockImplementation(async () => {
      signalMarkReadStarted?.();
      return markReadResponse;
    });

    await savePendingNotificationNavigation({
      notificationId: notificationA,
      target: targetA,
    });
    markNotificationNavigationPending();

    const markA = markPendingNotificationRead({
      handoff: { notificationId: notificationA, target: targetA },
      expectedTarget: targetA,
    });
    await markReadStarted;

    await savePendingNotificationNavigation({
      notificationId: notificationB,
      target: targetB,
    });
    markNotificationNavigationPending();
    releaseMarkRead?.({
      data: {
        ok: true,
        authorized: true,
        state: 'read',
        updated: 1,
      },
      error: null,
    });

    await expect(markA).resolves.toEqual({
      ok: true,
      state: 'read',
      updated: 1,
    });
    await expect(getPendingNotificationNavigation()).resolves.toMatchObject({
      notificationId: notificationB,
      target: targetB,
    });
    expect(hasPendingNotificationNavigationIntent()).toBe(true);
    await expect(waitForNotificationNavigationDecision()).resolves.toBe(true);
  });
});
