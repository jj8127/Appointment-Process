import { startSessionLogout } from '@/lib/session-logout';

describe('startSessionLogout', () => {
  test('starts local session clearing before a pending remote push cleanup can settle', () => {
    const callOrder: string[] = [];
    const clearLocalSession = jest.fn(() => {
      callOrder.push('clear-local');
      return Promise.resolve();
    });
    const unregisterPushTokens = jest.fn(() => {
      callOrder.push('unregister-push');
      return new Promise<{ ok: true; retryable: false; reason: 'unregistered' }>(() => {});
    });

    expect(startSessionLogout({
      sessionToken: 'captured-session-token',
      clearLocalSession,
      unregisterPushTokens,
      onLocalClearFailure: jest.fn(),
      onPushUnregisterFailure: jest.fn(),
    })).toBeUndefined();

    expect(callOrder).toEqual(['clear-local', 'unregister-push']);
    expect(clearLocalSession).toHaveBeenCalledTimes(1);
    expect(unregisterPushTokens).toHaveBeenCalledWith('captured-session-token');
  });

  test('reports only the fixed remote cleanup reason without blocking logout', async () => {
    const onPushUnregisterFailure = jest.fn();

    startSessionLogout({
      sessionToken: 'captured-session-token',
      clearLocalSession: jest.fn().mockResolvedValue(undefined),
      unregisterPushTokens: jest.fn().mockResolvedValue({
        ok: false,
        retryable: true,
        reason: 'unregister_failed',
      }),
      onLocalClearFailure: jest.fn(),
      onPushUnregisterFailure,
    });

    await Promise.resolve();

    expect(onPushUnregisterFailure).toHaveBeenCalledWith('unregister_failed');
  });

  test('skips remote cleanup when the signed app session token is absent', () => {
    const unregisterPushTokens = jest.fn();

    startSessionLogout({
      sessionToken: null,
      clearLocalSession: jest.fn().mockResolvedValue(undefined),
      unregisterPushTokens,
      onLocalClearFailure: jest.fn(),
      onPushUnregisterFailure: jest.fn(),
    });

    expect(unregisterPushTokens).not.toHaveBeenCalled();
  });
});
