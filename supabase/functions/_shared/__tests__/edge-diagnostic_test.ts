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
  | 'token'
  | 'jwt'
  | 'response'
  | 'json'
  | 'filename'
  | 'storagePath'
  | 'residentId'
  | 'targetId'
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

test('accepts every reviewed residual-closure event and reason pair', () => {
  const reviewedPairs: EdgeDiagnosticInput[] = [
    { event: 'set_password.referral_resolution', reason: 'code_lookup_failed' },
    { event: 'set_password.referral_resolution', reason: 'inviter_profile_lookup_failed' },
    { event: 'set_password.referral_resolution', reason: 'unexpected_error' },
    { event: 'set_password.referral_event', reason: 'insert_failed' },
    { event: 'set_password.referral_link', reason: 'apply_failed' },
    { event: 'fc_notify.admin_web_push', reason: 'request_failed' },
    { event: 'fc_notify.attachment_cleanup', reason: 'storage_remove_failed' },
    { event: 'fc_notify.notification_insert', reason: 'insert_failed' },
    { event: 'fc_notify.device_token_load', reason: 'query_failed' },
    { event: 'user_presence.rpc_fallback', reason: 'get_failed' },
    { event: 'user_presence.rpc_fallback', reason: 'touch_failed' },
    { event: 'user_presence.rpc_fallback', reason: 'stale_failed' },
    { event: 'referral_tree.load', reason: 'rpc_and_fallback_failed' },
    { event: 'board_create.push_fanout', reason: 'request_failed' },
    { event: 'board_create.notification_insert', reason: 'insert_failed' },
    { event: 'board_update.push_fanout', reason: 'request_failed' },
    { event: 'board_update.notification_insert', reason: 'insert_failed' },
    { event: 'board_attachment.storage', reason: 'delete_failed' },
    { event: 'board_attachment.storage', reason: 'signed_upload_url_failed' },
    { event: 'delete_account.storage_cleanup', reason: 'fc_documents_remove_failed' },
    { event: 'delete_account.storage_cleanup', reason: 'board_attachments_remove_failed' },
    { event: 'delete_account.storage_cleanup', reason: 'chat_uploads_remove_failed' },
    { event: 'exam_payment_proof.database', reason: 'database_operation_failed' },
    { event: 'exam_payment_proof.storage', reason: 'signed_upload_url_failed' },
    { event: 'exam_payment_proof.storage', reason: 'storage_remove_failed' },
  ];

  for (const input of reviewedPairs) {
    assert.deepEqual(buildEdgeDiagnosticRecord(input), input);
  }
});

test('drops poison fields even when a caller bypasses the type boundary', () => {
  const poison = {
    event: 'delete_account.storage_cleanup',
    reason: 'chat_uploads_remove_failed',
    status: 503,
    phone: '010-7777-8888',
    referral: 'REF-POISON-9284',
    id: '1d6f4f50-bb7b-4e96-bb50-df047acfed13',
    affiliation: 'POISON-AFFILIATION',
    body: 'upstream raw body POISON',
    json: { secret: 'POISON-JSON' },
    response: { body: 'POISON-RESPONSE' },
    token: 'POISON-TOKEN',
    jwt: 'POISON-JWT',
    filename: 'POISON-FILENAME.pdf',
    storagePath: 'private/POISON-STORAGE-PATH',
    residentId: 'POISON-RESIDENT-ID',
    targetId: 'POISON-TARGET-ID',
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
  assert.match(serialized, /delete_account\.storage_cleanup/);
  assert.match(serialized, /chat_uploads_remove_failed/);
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
    token: 'private-token',
    jwt: 'private-jwt',
    response: { body: 'raw' },
    json: { raw: true },
    filename: 'private.pdf',
    storagePath: '/private/storage',
    residentId: 'private-resident',
    targetId: 'private-target',
  };
  // @ts-expect-error variables carrying any raw field are outside the exact diagnostic contract
  reportEdgeDiagnostic(forbiddenVariable);
}
