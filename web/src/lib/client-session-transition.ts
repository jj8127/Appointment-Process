import type { QueryClient } from '@tanstack/react-query';

// Keep cookie-changing requests in order, including login while logout is pending.
// Web Locks also serialize cooperating tabs on browsers that support them.
export function createSessionTransitionQueue(
  lock: <T>(operation: () => Promise<T>) => Promise<T> = (operation) => operation(),
) {
  let pending: Promise<unknown> = Promise.resolve();
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(() => lock(operation));
    pending = result.catch(() => undefined);
    return result;
  };
}

export const withBrowserSessionTransition = createSessionTransitionQueue(async (operation) => {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('garamin-auth-session-transition', operation);
  }
  return operation();
});

export const ADMIN_WEB_LOGOUT_TIMEOUT_MS = 15_000;

export function clearSessionQueries(queryClient: QueryClient) {
  // Cancellation is synchronous; clear removes both query and mutation state.
  // A late query result remains attached to its removed Query, not the new cache.
  void queryClient.cancelQueries().catch(() => undefined);
  queryClient.clear();
}
