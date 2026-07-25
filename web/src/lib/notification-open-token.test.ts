import assert from 'node:assert/strict';
import test from 'node:test';

import { createNotificationOpenToken, verifyNotificationOpenToken } from './notification-open-token.ts';

const ID = '018f4f87-1ad4-7e39-9f5f-a89f2bdd9c11';
const SECRET = 'notification-open-test-secret-value';

test('round trips a short lived notification open token', () => {
  const token = createNotificationOpenToken({
    notificationId: ID,
    secret: SECRET,
    nowMs: 10_000,
  });
  assert.equal(
    verifyNotificationOpenToken({ token, secret: SECRET, nowMs: 20_000 })?.notificationId,
    ID,
  );
});

test('rejects tampering, invalid ids, and expired tokens', () => {
  const token = createNotificationOpenToken({
    notificationId: ID,
    secret: SECRET,
    nowMs: 10_000,
  });
  assert.equal(verifyNotificationOpenToken({ token: `${token}x`, secret: SECRET, nowMs: 20_000 }), null);
  assert.equal(verifyNotificationOpenToken({
    token,
    secret: SECRET,
    nowMs: 10_000 + 11 * 60 * 1000,
  }), null);
  assert.throws(() => createNotificationOpenToken({
    notificationId: '1',
    secret: SECRET,
  }));
});
