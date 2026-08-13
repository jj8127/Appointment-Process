import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAccountDeletionCleanupListLimit,
  preserveAccountDeletionCleanupAfterCrashBeforeRecord,
  sanitizeAccountDeletionCleanupErrorCode,
  transitionAccountDeletionCleanupAttempt,
  type AccountDeletionCleanupState,
} from '../account-deletion-cleanup-outbox-model.ts';

const pending = (attemptCount: number): AccountDeletionCleanupState => ({
  status: 'pending',
  attemptCount,
  lastErrorCode: null,
  nextAttemptAtMs: 1000,
  completedAtMs: null,
});

test('executes exponential retry and exhausts exactly on attempt 10', () => {
  const vectors = [
    { previous: 0, backoff: 30, status: 'pending', next: 1 },
    { previous: 1, backoff: 60, status: 'pending', next: 2 },
    { previous: 7, backoff: 3600, status: 'pending', next: 8 },
    { previous: 9, backoff: 3600, status: 'exhausted', next: 10 },
  ] as const;

  for (const vector of vectors) {
    const result = transitionAccountDeletionCleanupAttempt({
      state: pending(vector.previous),
      succeeded: false,
      errorCode: 'Storage/API 500',
      nowMs: 5000,
    });
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.backoffSeconds, vector.backoff);
    assert.equal(result.state.status, vector.status);
    assert.equal(result.state.attemptCount, vector.next);
    assert.equal(result.state.nextAttemptAtMs, 5000 + vector.backoff * 1000);
    assert.equal(result.state.lastErrorCode, 'storage_api_500');
  }
});

test('moves pending to completed and preserves pending on crash without record', () => {
  const committed = Object.freeze(pending(0));
  const afterCrashWithoutRecord =
    preserveAccountDeletionCleanupAfterCrashBeforeRecord(committed);
  assert.deepEqual(afterCrashWithoutRecord, pending(0));

  assert.deepEqual(
    transitionAccountDeletionCleanupAttempt({
      state: pending(0),
      succeeded: true,
      nowMs: 5000,
    }),
    {
      ok: true,
      state: {
        status: 'completed',
        attemptCount: 1,
        lastErrorCode: null,
        nextAttemptAtMs: 1000,
        completedAtMs: 5000,
      },
      backoffSeconds: null,
    },
  );
});

test('bounds error codes and pending-list limits', () => {
  assert.equal(sanitizeAccountDeletionCleanupErrorCode(''), 'post_commit_cleanup_failed');
  assert.equal(
    sanitizeAccountDeletionCleanupErrorCode(`A${'!'.repeat(100)}`).length,
    64,
  );
  assert.equal(normalizeAccountDeletionCleanupListLimit(null), 10);
  assert.equal(normalizeAccountDeletionCleanupListLimit(-1), 1);
  assert.equal(normalizeAccountDeletionCleanupListLimit(26), 25);
});
