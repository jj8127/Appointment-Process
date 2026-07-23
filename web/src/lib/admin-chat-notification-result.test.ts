import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyAdminChatNotificationResult,
  classifyFcNotificationResult,
} from './admin-chat-notification-result.ts';

test('confirms a logged notification with at least one mobile target', () => {
  assert.deepStrictEqual(
    classifyAdminChatNotificationResult(200, {
      ok: true,
      data: { ok: true, logged: true, sent: 1 },
    }),
    { ok: true, sent: 1 },
  );
  assert.deepStrictEqual(
    classifyFcNotificationResult(200, {
      ok: true,
      data: { ok: true, logged: true, sent: 2 },
    }),
    { ok: true, sent: 2 },
  );
});

test('rejects HTTP, malformed, downstream, persistence, and zero-target failures', () => {
  assert.deepStrictEqual(
    classifyAdminChatNotificationResult(500, null),
    { ok: false, reason: 'http_error' },
  );
  assert.deepStrictEqual(
    classifyAdminChatNotificationResult(200, { ok: false }),
    { ok: false, reason: 'invalid_response' },
  );
  assert.deepStrictEqual(
    classifyAdminChatNotificationResult(200, { ok: true, data: { ok: false } }),
    { ok: false, reason: 'downstream_error' },
  );
  assert.deepStrictEqual(
    classifyAdminChatNotificationResult(200, {
      ok: true,
      data: { ok: true, logged: false, sent: 1 },
    }),
    { ok: false, reason: 'not_logged' },
  );
  assert.deepStrictEqual(
    classifyAdminChatNotificationResult(200, {
      ok: true,
      data: { ok: true, logged: true, sent: 0 },
    }),
    { ok: false, reason: 'no_device_target' },
  );
  assert.deepStrictEqual(
    classifyFcNotificationResult(200, {
      ok: true,
      data: { ok: true, logged: true, sent: '1' },
    }),
    { ok: false, reason: 'no_device_target' },
  );
});
