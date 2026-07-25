import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  getAccountDeletionCleanupBackoffSeconds,
  normalizeAccountDeletionCleanupListLimit,
  preserveAccountDeletionCleanupAfterCrashBeforeRecord,
  sanitizeAccountDeletionCleanupErrorCode,
  transitionAccountDeletionCleanupAttempt,
  type AccountDeletionCleanupState,
} from '../../supabase/functions/_shared/account-deletion-cleanup-outbox-model';

const pendingState = (
  attemptCount = 0,
): AccountDeletionCleanupState => ({
  status: 'pending',
  attemptCount,
  lastErrorCode: null,
  nextAttemptAtMs: 1_000,
  completedAtMs: null,
});

describe('account deletion cleanup outbox behavior', () => {
  it.each([
    [0, 30],
    [1, 60],
    [2, 120],
    [6, 1920],
    [7, 3600],
    [9, 3600],
  ])(
    'increments attempt %i with an exponential backoff capped at %i seconds',
    (previousAttemptCount, expectedBackoffSeconds) => {
      const nowMs = 2_000_000;
      const result = transitionAccountDeletionCleanupAttempt({
        state: pendingState(previousAttemptCount),
        succeeded: false,
        errorCode: 'storage_failed',
        nowMs,
      });

      expect(result).toMatchObject({
        ok: true,
        backoffSeconds: expectedBackoffSeconds,
        state: {
          attemptCount: Math.min(previousAttemptCount + 1, 10),
          nextAttemptAtMs: nowMs + (expectedBackoffSeconds * 1000),
          completedAtMs: null,
        },
      });
      expect(getAccountDeletionCleanupBackoffSeconds(previousAttemptCount))
        .toBe(expectedBackoffSeconds);
    },
  );

  it('moves pending to completed and clears the error on successful cleanup', () => {
    expect(transitionAccountDeletionCleanupAttempt({
      state: {
        ...pendingState(3),
        lastErrorCode: 'storage_failed',
        nextAttemptAtMs: 999_000,
      },
      succeeded: true,
      errorCode: 'must_not_be_retained',
      nowMs: 2_000_000,
    })).toEqual({
      ok: true,
      state: {
        status: 'completed',
        attemptCount: 4,
        lastErrorCode: null,
        nextAttemptAtMs: 999_000,
        completedAtMs: 2_000_000,
      },
      backoffSeconds: null,
    });
  });

  it('keeps failures pending before attempt 10 and exhausts exactly on attempt 10', () => {
    expect(transitionAccountDeletionCleanupAttempt({
      state: pendingState(8),
      succeeded: false,
      errorCode: 'auth_failed',
      nowMs: 1000,
    })).toMatchObject({
      ok: true,
      state: { status: 'pending', attemptCount: 9 },
    });
    expect(transitionAccountDeletionCleanupAttempt({
      state: pendingState(9),
      succeeded: false,
      errorCode: 'auth_failed',
      nowMs: 1000,
    })).toMatchObject({
      ok: true,
      state: { status: 'exhausted', attemptCount: 10 },
    });
  });

  it('rejects a duplicate record after completion', () => {
    expect(transitionAccountDeletionCleanupAttempt({
      state: {
        status: 'completed',
        attemptCount: 1,
        lastErrorCode: null,
        nextAttemptAtMs: 1000,
        completedAtMs: 1000,
      },
      succeeded: true,
      nowMs: 2000,
    })).toEqual({
      ok: false,
      code: 'cleanup_outbox_not_pending',
    });
  });

  it.each([
    [' Storage/API 500 ', 'storage_api_500'],
    ['', 'post_commit_cleanup_failed'],
    [null, 'post_commit_cleanup_failed'],
    ['한글 오류', '_____'],
    [`A${'!'.repeat(100)}`, `a${'_'.repeat(63)}`],
  ])('stores only a bounded static error code for %p', (input, expected) => {
    expect(sanitizeAccountDeletionCleanupErrorCode(input)).toBe(expected);
  });

  it.each([
    [undefined, 10],
    [null, 10],
    [Number.NaN, 10],
    [-5, 1],
    [0, 1],
    [1, 1],
    [25, 25],
    [26, 25],
    [Number.POSITIVE_INFINITY, 10],
  ])('clamps pending-list limit %p to %i', (input, expected) => {
    expect(normalizeAccountDeletionCleanupListLimit(input)).toBe(expected);
  });

  it('leaves a committed pending row unchanged when the process crashes before recording', () => {
    const committedOutboxRow = Object.freeze(pendingState(0));
    const stateAfterCrashWithoutRecord =
      preserveAccountDeletionCleanupAfterCrashBeforeRecord(
        committedOutboxRow,
      );

    expect(stateAfterCrashWithoutRecord).toEqual({
      status: 'pending',
      attemptCount: 0,
      lastErrorCode: null,
      nextAttemptAtMs: 1000,
      completedAtMs: null,
    });
  });
});

describe('cleanup outbox executable model stays aligned with SQL rules', () => {
  const root = path.resolve(__dirname, '..', '..');
  const migration = readFileSync(
    path.join(
      root,
      'supabase',
      'migrations',
      '20260724131931_exam_bundle_monthly_slot_and_decisions.sql',
    ),
    'utf8',
  );

  it('guards the exact attempt, backoff, sanitization, and limit rules modeled above', () => {
    expect(migration).toContain(
      'attempt_count = least(outbox.attempt_count + 1, 10)',
    );
    expect(migration).toContain(
      'when outbox.attempt_count + 1 >= 10 then',
    );
    expect(migration).toContain(
      "least(3600, 30 * power(2, least(outbox.attempt_count, 9)))",
    );
    expect(migration).toContain(
      "regexp_replace(lower(btrim(coalesce(p_error_code, ''))), '[^a-z0-9_]', '_', 'g')",
    );
    expect(migration).toContain(
      'limit least(greatest(coalesce(p_limit, 10), 1), 25)',
    );
  });
});
