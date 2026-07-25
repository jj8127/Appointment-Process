export type AccountDeletionCleanupStatus =
  | 'pending'
  | 'completed'
  | 'exhausted';

export type AccountDeletionCleanupState = {
  status: AccountDeletionCleanupStatus;
  attemptCount: number;
  lastErrorCode: string | null;
  nextAttemptAtMs: number;
  completedAtMs: number | null;
};

export type AccountDeletionCleanupTransitionResult =
  | {
      ok: true;
      state: AccountDeletionCleanupState;
      backoffSeconds: number | null;
    }
  | {
      ok: false;
      code: 'cleanup_outbox_not_pending';
    };

export const ACCOUNT_DELETION_CLEANUP_MAX_ATTEMPTS = 10;
export const ACCOUNT_DELETION_CLEANUP_DEFAULT_LIMIT = 10;
export const ACCOUNT_DELETION_CLEANUP_MAX_LIMIT = 25;

export function sanitizeAccountDeletionCleanupErrorCode(
  value: unknown,
): string {
  const sanitized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 64);
  return sanitized || 'post_commit_cleanup_failed';
}

export function normalizeAccountDeletionCleanupListLimit(
  value?: number | null,
): number {
  const finite = typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : ACCOUNT_DELETION_CLEANUP_DEFAULT_LIMIT;
  return Math.min(
    ACCOUNT_DELETION_CLEANUP_MAX_LIMIT,
    Math.max(1, finite),
  );
}

export function getAccountDeletionCleanupBackoffSeconds(
  previousAttemptCount: number,
): number {
  const safeAttemptCount = Math.min(
    ACCOUNT_DELETION_CLEANUP_MAX_ATTEMPTS - 1,
    Math.max(0, Math.trunc(previousAttemptCount)),
  );
  return Math.min(3600, 30 * (2 ** safeAttemptCount));
}

export function preserveAccountDeletionCleanupAfterCrashBeforeRecord(
  state: AccountDeletionCleanupState,
): AccountDeletionCleanupState {
  return { ...state };
}

export function transitionAccountDeletionCleanupAttempt({
  state,
  succeeded,
  errorCode,
  nowMs,
}: {
  state: AccountDeletionCleanupState;
  succeeded: boolean;
  errorCode?: unknown;
  nowMs: number;
}): AccountDeletionCleanupTransitionResult {
  if (state.status !== 'pending' && state.status !== 'exhausted') {
    return { ok: false, code: 'cleanup_outbox_not_pending' };
  }

  const attemptCount = Math.min(
    Math.max(0, Math.trunc(state.attemptCount)) + 1,
    ACCOUNT_DELETION_CLEANUP_MAX_ATTEMPTS,
  );
  if (succeeded) {
    return {
      ok: true,
      state: {
        status: 'completed',
        attemptCount,
        lastErrorCode: null,
        nextAttemptAtMs: state.nextAttemptAtMs,
        completedAtMs: nowMs,
      },
      backoffSeconds: null,
    };
  }

  const backoffSeconds = getAccountDeletionCleanupBackoffSeconds(
    state.attemptCount,
  );
  return {
    ok: true,
    state: {
      status: attemptCount >= ACCOUNT_DELETION_CLEANUP_MAX_ATTEMPTS
        ? 'exhausted'
        : 'pending',
      attemptCount,
      lastErrorCode: sanitizeAccountDeletionCleanupErrorCode(errorCode),
      nextAttemptAtMs: nowMs + (backoffSeconds * 1000),
      completedAtMs: null,
    },
    backoffSeconds,
  };
}
