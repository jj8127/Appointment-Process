type NotificationNavigationCoordinatorState =
  | 'bootstrapping'
  | 'idle'
  | 'pending';

let state: NotificationNavigationCoordinatorState = 'bootstrapping';
const bootstrapWaiters = new Set<(hasPending: boolean) => void>();
const destinationAcceptanceListeners = new Set<(notificationId: string) => void>();

function settleBootstrapWaiters() {
  if (state === 'bootstrapping') return;
  const hasPending = state === 'pending';
  for (const resolve of bootstrapWaiters) resolve(hasPending);
  bootstrapWaiters.clear();
}

export function markNotificationNavigationPending() {
  state = 'pending';
  settleBootstrapWaiters();
}

export function markNotificationNavigationIdle() {
  state = 'idle';
  settleBootstrapWaiters();
}

export function markNotificationBootstrapReady(hasPending: boolean) {
  if (state === 'pending') {
    settleBootstrapWaiters();
    return;
  }
  state = hasPending ? 'pending' : 'idle';
  settleBootstrapWaiters();
}

export function hasPendingNotificationNavigationIntent(): boolean {
  return state === 'pending';
}

export function waitForNotificationNavigationDecision(): Promise<boolean> {
  if (state !== 'bootstrapping') {
    return Promise.resolve(state === 'pending');
  }
  return new Promise((resolve) => {
    bootstrapWaiters.add(resolve);
  });
}

export function notifyNotificationDestinationAccepted(notificationId: string) {
  for (const listener of destinationAcceptanceListeners) listener(notificationId);
}

export function subscribeNotificationDestinationAcceptance(
  listener: (notificationId: string) => void,
) {
  destinationAcceptanceListeners.add(listener);
  return () => {
    destinationAcceptanceListeners.delete(listener);
  };
}

export function resetNotificationNavigationCoordinatorForTests() {
  state = 'bootstrapping';
  bootstrapWaiters.clear();
  destinationAcceptanceListeners.clear();
}
