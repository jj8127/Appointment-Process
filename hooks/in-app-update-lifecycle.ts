type StartUpdate = () => Promise<void>;

/** One check per JS process; an unmounted effect cannot present its late result. */
export function createInAppUpdateRequest(
  check: () => Promise<StartUpdate | null>,
  onFailure: () => void,
) {
  let pending: Promise<StartUpdate | null> | undefined;
  let started = false;

  return () => {
    let active = true;
    pending ??= Promise.resolve().then(check).catch(() => {
      onFailure();
      return null;
    });
    void pending.then(async (startUpdate) => {
      if (!active || started || !startUpdate) return;
      started = true;
      try {
        await startUpdate();
      } catch {
        onFailure();
      }
    });
    return () => { active = false; };
  };
}

/** App Store marketing versions and minimum iOS versions are numeric components. */
export function compareUpdateVersions(first: string, second: string): -1 | 0 | 1 {
  if (!/^\d+(?:\.\d+)*$/.test(first) || !/^\d+(?:\.\d+)*$/.test(second)) return 0;
  const left = first.split('.').map(Number);
  const right = second.split('.').map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}
