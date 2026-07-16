import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildEdgeDiagnosticRecord,
  reportEdgeDiagnostic,
  type EdgeDiagnosticInput,
} from '../edge-diagnostic.ts';

type ForbiddenInputKey = Extract<
  keyof EdgeDiagnosticInput,
  | 'error'
  | 'message'
  | 'stack'
  | 'cause'
  | 'body'
  | 'url'
  | 'path'
  | 'id'
  | 'phone'
  | 'referral'
  | 'affiliation'
>;
const noForbiddenInputKeys: ForbiddenInputKey extends never ? true : false = true;
void noForbiddenInputKeys;

test('preserves only reviewed diagnostic fields', () => {
  assert.deepEqual(
    buildEdgeDiagnosticRecord({
      event: 'request_board.password_sync',
      reason: 'upstream_rejected',
      status: 503,
      count: 2,
      retryable: true,
      errorClass: 'upstream',
    }),
    {
      event: 'request_board.password_sync',
      reason: 'upstream_rejected',
      status: 503,
      count: 2,
      retryable: true,
      errorClass: 'upstream',
    },
  );
});

test('drops poison fields even when a caller bypasses the type boundary', () => {
  const poison = {
    event: 'request_board.password_sync',
    reason: 'upstream_rejected',
    status: 503,
    phone: '010-7777-8888',
    referral: 'REF-POISON-9284',
    id: '1d6f4f50-bb7b-4e96-bb50-df047acfed13',
    affiliation: 'POISON-AFFILIATION',
    body: 'upstream raw body POISON',
    json: { secret: 'POISON-JSON' },
    error: new Error('POISON-ERROR'),
    message: 'POISON-MESSAGE',
    stack: 'POISON-STACK',
    cause: 'POISON-CAUSE',
    unknownValue: { nested: 'POISON-UNKNOWN' } as unknown,
    url: 'https://poison.example/private/path',
    path: '/private/path',
  } as unknown as EdgeDiagnosticInput;

  const originalWarn = console.warn;
  const captured: unknown[][] = [];
  console.warn = (...args: unknown[]) => captured.push(args);
  try {
    reportEdgeDiagnostic(poison);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(captured.length, 1);
  const serialized = JSON.stringify(captured);
  for (const canary of [
    '010-7777-8888',
    'REF-POISON-9284',
    '1d6f4f50-bb7b-4e96-bb50-df047acfed13',
    'POISON-AFFILIATION',
    'POISON',
    'poison.example',
    '/private/path',
  ]) {
    assert.equal(serialized.includes(canary), false, canary);
  }
  assert.match(serialized, /request_board\.password_sync/);
  assert.match(serialized, /upstream_rejected/);
  assert.match(serialized, /503/);
});

test('uses a fixed fallback for invalid pairs and drops invalid scalar values', () => {
  assert.deepEqual(
    buildEdgeDiagnosticRecord({
      event: 'attacker.controlled',
      reason: 'raw reason',
      body: 'POISON-BODY',
    } as unknown as EdgeDiagnosticInput),
    {
      event: 'edge_diagnostic.rejected',
      reason: 'invalid_diagnostic_input',
    },
  );

  assert.deepEqual(
    buildEdgeDiagnosticRecord({
      event: 'request_board.password_sync',
      reason: 'request_failed',
      status: Number.NaN,
      count: -1,
      retryable: 'yes',
      errorClass: 'raw-error',
    } as unknown as EdgeDiagnosticInput),
    {
      event: 'request_board.password_sync',
      reason: 'request_failed',
    },
  );
});

test('does not let a failing diagnostic sink escape', () => {
  const originalWarn = console.warn;
  console.warn = () => {
    throw new Error('sink unavailable');
  };
  try {
    assert.doesNotThrow(() => {
      reportEdgeDiagnostic({
        event: 'fc_notify.recipient_resolution',
        reason: 'no_admin_recipients',
        count: 0,
      });
    });
  } finally {
    console.warn = originalWarn;
  }
});

if (false) {
  const forbiddenVariable = {
    event: 'request_board.password_sync' as const,
    reason: 'request_failed' as const,
    error: new Error('raw'),
    unknownValue: {} as unknown,
    message: 'raw',
    stack: 'raw',
    cause: 'raw',
    body: 'raw',
    url: 'https://private.example',
    path: '/private',
    id: 'private-id',
    phone: '01000000000',
    referral: 'private-referral',
    affiliation: 'private-affiliation',
  };
  // @ts-expect-error variables carrying any raw field are outside the exact diagnostic contract
  reportEdgeDiagnostic(forbiddenVariable);
}
