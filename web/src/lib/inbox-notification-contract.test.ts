import assert from 'node:assert/strict';
import test from 'node:test';

import { isInboxNotificationPayload } from './inbox-notification-contract.ts';

const notification = {
  id: '00000000-0000-4000-8000-000000000001',
  title: '알림',
  body: '내용',
  category: null,
  target: null,
  created_at: '2026-10-13T00:00:00.000Z',
  read_at: null,
  dismissed_at: null,
};

test('inbox notification contract accepts the complete canonical payload', () => {
  assert.equal(isInboxNotificationPayload(notification), true);
});

test('inbox notification contract rejects missing receipt timestamps', () => {
  for (const field of ['created_at', 'read_at', 'dismissed_at']) {
    const malformed = { ...notification } as Record<string, unknown>;
    delete malformed[field];
    assert.equal(isInboxNotificationPayload(malformed), false, field);
  }
});

test('inbox notification contract rejects malformed timestamps', () => {
  for (const field of ['created_at', 'read_at', 'dismissed_at']) {
    assert.equal(isInboxNotificationPayload({ ...notification, [field]: 'not-a-date' }), false, field);
  }
});

test('inbox notification contract requires a non-null creation timestamp', () => {
  assert.equal(isInboxNotificationPayload({ ...notification, created_at: null }), false);
});
