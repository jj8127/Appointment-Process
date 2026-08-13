import {
  hasPendingNotificationNavigationIntent,
  markNotificationBootstrapReady,
  markNotificationNavigationIdle,
  markNotificationNavigationPending,
  notifyNotificationDestinationAccepted,
  resetNotificationNavigationCoordinatorForTests,
  subscribeNotificationDestinationAcceptance,
  waitForNotificationNavigationDecision,
} from '../notification-navigation-coordinator';

describe('post-login notification navigation coordinator', () => {
  beforeEach(() => {
    resetNotificationNavigationCoordinatorForTests();
  });

  it('suppresses the default login route when bootstrap restores a pending target', async () => {
    const decision = waitForNotificationNavigationDecision();
    markNotificationBootstrapReady(true);

    await expect(decision).resolves.toBe(true);
    expect(hasPendingNotificationNavigationIntent()).toBe(true);
  });

  it('allows the default login route only after bootstrap proves no pending target', async () => {
    const decision = waitForNotificationNavigationDecision();
    markNotificationBootstrapReady(false);

    await expect(decision).resolves.toBe(false);
    expect(hasPendingNotificationNavigationIntent()).toBe(false);
  });

  it('keeps a warm notification capture pending even if bootstrap finishes later', async () => {
    const decision = waitForNotificationNavigationDecision();
    markNotificationNavigationPending();
    markNotificationBootstrapReady(false);

    await expect(decision).resolves.toBe(true);
    expect(hasPendingNotificationNavigationIntent()).toBe(true);
    markNotificationNavigationIdle();
    expect(hasPendingNotificationNavigationIntent()).toBe(false);
  });

  it('marks an attempted route handled only after the destination accepts it', () => {
    const accepted: string[] = [];
    const unsubscribe = subscribeNotificationDestinationAcceptance((id) => {
      accepted.push(id);
    });

    expect(accepted).toEqual([]);
    notifyNotificationDestinationAccepted(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(accepted).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    ]);

    unsubscribe();
    notifyNotificationDestinationAccepted(
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
    expect(accepted).toHaveLength(1);
  });
});
