import type { PushTokenUnregisterResult } from '@/lib/notifications';

type StartSessionLogoutOptions = {
  sessionToken: string | null;
  clearLocalSession: () => Promise<void>;
  unregisterPushTokens: (sessionToken: string) => Promise<PushTokenUnregisterResult>;
  onLocalClearFailure: () => void;
  onPushUnregisterFailure: (reason: PushTokenUnregisterResult['reason']) => void;
};

export function startSessionLogout({
  sessionToken,
  clearLocalSession,
  unregisterPushTokens,
  onLocalClearFailure,
  onPushUnregisterFailure,
}: StartSessionLogoutOptions): void {
  try {
    void clearLocalSession().catch(() => {
      onLocalClearFailure();
    });
  } catch {
    onLocalClearFailure();
  }

  if (!sessionToken) return;

  try {
    void unregisterPushTokens(sessionToken)
      .then((result) => {
        if (!result.ok) {
          onPushUnregisterFailure(result.reason);
        }
      })
      .catch(() => {
        onPushUnregisterFailure('unregister_failed');
      });
  } catch {
    onPushUnregisterFailure('unregister_failed');
  }
}
