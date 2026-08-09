export type ReferralRevenueOrientation = 'landscape' | 'portrait';

export type ReferralRevenueOrientationState = {
  canView: boolean;
  hydrated: boolean;
  isFocused: boolean;
  viewMode: 'graph' | 'tree' | 'list';
};

export type ReferralRevenueOrientationAdapter = {
  lock: (orientation: ReferralRevenueOrientation) => Promise<void>;
  supportsLandscape?: () => Promise<boolean>;
};

export function getReferralRevenueDesiredOrientation({
  canView,
  hydrated,
  isFocused,
  viewMode,
}: ReferralRevenueOrientationState): ReferralRevenueOrientation {
  return hydrated && canView && isFocused && viewMode === 'graph'
    ? 'landscape'
    : 'portrait';
}

export function createReferralRevenueOrientationCoordinator(
  adapter: ReferralRevenueOrientationAdapter,
) {
  let latestRevision = 0;
  let pending = Promise.resolve();
  let landscapeSupport: Promise<boolean> | null = null;

  const supportsLandscape = () => {
    landscapeSupport ??= adapter.supportsLandscape?.().catch(() => false)
      ?? Promise.resolve(true);
    return landscapeSupport;
  };

  const enqueueLock = (
    orientation: ReferralRevenueOrientation,
    revision: number,
  ) => {
    pending = pending
      .catch(() => undefined)
      .then(async () => {
        if (revision !== latestRevision) return;
        await adapter.lock(orientation);
      })
      .catch(() => undefined);
    return pending;
  };

  const request = (orientation: ReferralRevenueOrientation) => {
    const revision = ++latestRevision;
    if (orientation === 'portrait') {
      return enqueueLock(orientation, revision);
    }
    return supportsLandscape()
      .then((supported) => {
        if (!supported || revision !== latestRevision) return;
        return enqueueLock(orientation, revision);
      })
      .catch(() => undefined);
  };

  return {
    request,
  };
}
