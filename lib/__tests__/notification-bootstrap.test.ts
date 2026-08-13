import {
  bootstrapNotificationNavigation,
  clearNativeNotificationResponseIfCurrent,
  notificationCaptureMatches,
  processNotificationResponseSafely,
} from '../notification-bootstrap';

type Response = { key: string; notification?: object };

describe('notification cold bootstrap behavior', () => {
  it('settles bootstrap only after the initial response has been captured', async () => {
    const events: string[] = [];
    let pending = false;

    await bootstrapNotificationNavigation<Response>({
      restorePending: async () => {
        events.push('restore');
      },
      getInitialResponse: async () => {
        events.push('read-native');
        return { key: 'A', notification: {} };
      },
      isNotificationResponse: (response) => Boolean(response?.notification),
      enqueueResponse: async () => {
        events.push('capture');
        pending = true;
      },
      hasPending: () => pending,
      markReady: (hasPending) => {
        events.push(`ready:${hasPending}`);
      },
    });

    expect(events).toEqual([
      'restore',
      'read-native',
      'capture',
      'ready:true',
    ]);
  });

  it('keeps a captured pending target when native cleanup throws', async () => {
    let pending: Response | null = null;

    await expect(
      processNotificationResponseSafely({
        response: { key: 'A', notification: {} },
        captureResponse: async (response) => {
          pending = response;
        },
        clearNativeResponseIfCurrent: async () => {
          throw new Error('native cleanup unavailable');
        },
      }),
    ).resolves.toBeUndefined();

    expect(pending).toEqual({ key: 'A', notification: {} });
  });

  it('does not clear a newer B response while processing captured A', async () => {
    let nativeResponse: Response | null = { key: 'B', notification: {} };
    let clearCalls = 0;

    await clearNativeNotificationResponseIfCurrent({
      capturedResponse: { key: 'A', notification: {} },
      getResponseKey: (response) => response?.key ?? '',
      getCurrentResponse: async () => nativeResponse,
      clearCurrentResponse: async () => {
        clearCalls += 1;
        nativeResponse = null;
      },
    });

    expect(clearCalls).toBe(0);
    expect(nativeResponse).toEqual({ key: 'B', notification: {} });
  });

  it('makes a newer B capture authoritative before A storage settles', async () => {
    const targetA = {
      version: 1 as const,
      kind: 'board_post' as const,
      postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    };
    const targetB = {
      version: 1 as const,
      kind: 'board_post' as const,
      postId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };
    const captureA = {
      notificationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      target: targetA,
    };
    const captureB = {
      notificationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      target: targetB,
    };
    let current: typeof captureA | null = captureA;

    current = captureB;

    expect(notificationCaptureMatches(current, captureA)).toBe(false);
    expect(notificationCaptureMatches(current, captureB)).toBe(true);
    if (notificationCaptureMatches(current, captureA)) {
      current = null;
    }
    expect(current).toEqual(captureB);
  });

  it('still settles from restored state when native response reads fail', async () => {
    const ready: boolean[] = [];
    let pending = true;

    await bootstrapNotificationNavigation<Response>({
      restorePending: async () => {
        pending = true;
      },
      getInitialResponse: async () => {
        throw new Error('native read unavailable');
      },
      isNotificationResponse: (response) => Boolean(response?.notification),
      enqueueResponse: async () => {
        throw new Error('must not run');
      },
      hasPending: () => pending,
      markReady: (hasPending) => ready.push(hasPending),
    });

    expect(ready).toEqual([true]);
  });
});
