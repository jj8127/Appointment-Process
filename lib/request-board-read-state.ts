/** Ignore completions from an older request, account, or conversation. */
export function createReadScope() {
  let scope = '';
  let generation = 0;
  let ownerGeneration = 0;
  return {
    setScope(next: string) {
      if (next === scope) return false;
      scope = next;
      generation += 1;
      ownerGeneration += 1;
      return true;
    },
    matches(expected: string) { return scope === expected; },
    captureOwner(expected: string) {
      const captured = ownerGeneration;
      return () => scope === expected && ownerGeneration === captured;
    },
    issue() {
      const issued = ++generation;
      return () => issued === generation;
    },
    invalidate() { generation += 1; ownerGeneration += 1; },
  };
}
