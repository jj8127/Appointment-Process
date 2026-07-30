import {
  createReferralRevenueOrientationCoordinator,
  getReferralRevenueDesiredOrientation,
} from '@/lib/referral-revenue-orientation';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('referral revenue orientation', () => {
  it('uses landscape only for a focused, viewable graph', () => {
    expect(getReferralRevenueDesiredOrientation({
      canView: true,
      hydrated: true,
      isFocused: true,
      viewMode: 'graph',
    })).toBe('landscape');

    for (const state of [
      {
        canView: true,
        hydrated: true,
        isFocused: true,
        viewMode: 'list' as const,
      },
      {
        canView: true,
        hydrated: true,
        isFocused: false,
        viewMode: 'graph' as const,
      },
      {
        canView: false,
        hydrated: true,
        isFocused: true,
        viewMode: 'graph' as const,
      },
      {
        canView: true,
        hydrated: false,
        isFocused: true,
        viewMode: 'graph' as const,
      },
    ]) {
      expect(getReferralRevenueDesiredOrientation(state)).toBe('portrait');
    }
  });

  it('does not let a slow landscape support probe block portrait restore', async () => {
    const support = createDeferred<boolean>();
    const locks: string[] = [];
    const coordinator = createReferralRevenueOrientationCoordinator({
      supportsLandscape: () => support.promise,
      lock: async (orientation) => {
        locks.push(orientation);
      },
    });

    const staleLandscape = coordinator.request('landscape');
    await coordinator.request('portrait');
    expect(locks).toEqual(['portrait']);

    support.resolve(true);
    await staleLandscape;
    expect(locks).toEqual(['portrait']);
  });

  it('serializes an in-flight landscape lock before the latest portrait lock', async () => {
    const landscapeStarted = createDeferred<void>();
    const landscapeLock = createDeferred<void>();
    const events: string[] = [];
    const coordinator = createReferralRevenueOrientationCoordinator({
      supportsLandscape: async () => true,
      lock: async (orientation) => {
        events.push(`${orientation}:start`);
        if (orientation === 'landscape') {
          landscapeStarted.resolve(undefined);
          await landscapeLock.promise;
        }
        events.push(`${orientation}:end`);
      },
    });

    const landscape = coordinator.request('landscape');
    await landscapeStarted.promise;
    expect(events).toEqual(['landscape:start']);

    const portrait = coordinator.request('portrait');
    landscapeLock.resolve(undefined);
    await Promise.all([landscape, portrait]);

    expect(events).toEqual([
      'landscape:start',
      'landscape:end',
      'portrait:start',
      'portrait:end',
    ]);
  });

  it('leaves the current orientation unchanged when landscape is unsupported', async () => {
    const locks: string[] = [];
    const coordinator = createReferralRevenueOrientationCoordinator({
      supportsLandscape: async () => false,
      lock: async (orientation) => {
        locks.push(orientation);
      },
    });

    await coordinator.request('landscape');
    expect(locks).toEqual([]);

    await coordinator.request('portrait');
    expect(locks).toEqual(['portrait']);
  });
});
