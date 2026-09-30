/** Ignore completions from an older request, account, or conversation. */
export function createReadScope() {
  let scope = '';
  let generation = 0;
  return {
    setScope(next: string) {
      if (next === scope) return false;
      scope = next;
      generation += 1;
      return true;
    },
    matches(expected: string) { return scope === expected; },
    issue() {
      const issued = ++generation;
      return () => issued === generation;
    },
    invalidate() { generation += 1; },
  };
}
