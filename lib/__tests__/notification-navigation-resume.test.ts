import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('notification navigation resume boundary', () => {
  it('installs the response listener before restore/last-response awaits and serializes captures', () => {
    const source = read('app/_layout.tsx');
    const effectStart = source.indexOf('const subscription =');
    const listenerIndex = source.indexOf(
      'Notifications.addNotificationResponseReceivedListener',
      effectStart,
    );
    const restoreIndex = source.indexOf(
      'const restored = await getPendingNotificationNavigation()',
      effectStart,
    );
    const lastResponseIndex = source.indexOf(
      'Notifications.getLastNotificationResponse',
      restoreIndex,
    );

    expect(listenerIndex).toBeGreaterThan(effectStart);
    expect(listenerIndex).toBeLessThan(restoreIndex);
    expect(restoreIndex).toBeLessThan(lastResponseIndex);
    expect(source).toContain('responseQueueRef.current.then(process, process)');
    expect(source).toContain('clearNativeResponseIfCurrent');
    expect(source).toContain('handledResponseIdsRef.current.get(responseKey)');
    expect(source).toContain("Date.now() - handledAt < 2_000");
  });

  it('clears only the matching stale capture before an invalid response can route', () => {
    const source = read('app/_layout.tsx');
    const clearStart = source.indexOf('const clearForUnavailableTarget');
    const clearEnd = source.indexOf('const captureResponse', clearStart);
    const clearBlock = source.slice(clearStart, clearEnd);

    expect(clearBlock).toContain('pendingRef.current = null');
    expect(clearBlock).toContain('setPending(null)');
    expect(clearBlock).toContain('acceptedNotificationIdsRef.current.clear()');
    expect(clearBlock).toContain('dispatchedNotificationIdsRef.current.clear()');
    expect(clearBlock).toContain(
      '!notificationCaptureMatches(pendingRef.current, expected)',
    );
    expect(clearBlock).toContain('await clearPendingNotificationNavigation(expected)');
    expect(clearBlock).toContain('setInvalidTargetPending(true)');
  });

  it('authorizes the current actor and exact stored target before route dispatch', () => {
    const source = read('app/_layout.tsx');
    const authorizeIndex = source.indexOf(
      'const authorization = await authorizeNotificationOpen',
    );
    const pushIndex = source.indexOf('router.push(route as never)', authorizeIndex);
    const dispatchedIndex = source.lastIndexOf(
      'dispatchedNotificationIdsRef.current.add',
      pushIndex,
    );
    const receipt = read('lib/notification-receipt.ts');

    expect(authorizeIndex).toBeGreaterThan(0);
    expect(pushIndex).toBeGreaterThan(authorizeIndex);
    expect(dispatchedIndex).toBeGreaterThan(authorizeIndex);
    expect(dispatchedIndex).toBeLessThan(pushIndex);
    expect(source).toContain('subscribeNotificationDestinationAcceptance');
    expect(receipt).toContain('notifyNotificationDestinationAccepted');
    expect(source).toContain(
      'pendingNotificationOwnerMatches(pending.owner, ownerBinding)',
    );
  });

  it('suppresses login fallback and preserves the exact handoff through identity gate', () => {
    const login = read('app/login.tsx');
    const gateHook = read('hooks/use-identity-gate.ts');
    const gate = read('app/apply-gate.tsx');
    const identity = read('app/identity.tsx');

    expect(login).toContain('waitForNotificationNavigationDecision()');
    expect(login).toContain('if (!active || hasPending) return');
    expect(gateHook).toContain('parseNotificationPushData({');
    expect(gateHook).toContain('buildNotificationTargetRoute({');
    expect(gateHook).toContain('params: { next: notificationNext');
    expect(gate).toContain('authorizeNotificationOpen(handoff)');
    expect(identity).toContain(
      'authorizeNotificationOpen(notificationHandoff)',
    );
  });
});
