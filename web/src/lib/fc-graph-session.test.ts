import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFcGraphSessionValue,
  verifyFcGraphSessionValue,
} from './fc-graph-session.ts';

const SECRET = 'test-secret-with-enough-length';
const NOW = new Date('2026-06-04T00:00:00.000Z').getTime();

test('FC graph session verifies signed resident-bound payloads', () => {
  const value = createFcGraphSessionValue({
    fcId: 'fc-1',
    residentDigits: '01012345678',
    nowMs: NOW,
    secret: SECRET,
  });

  const session = verifyFcGraphSessionValue(value, {
    expectedResidentDigits: '01012345678',
    nowMs: NOW + 1000,
    secret: SECRET,
  });

  assert.equal(session?.fcId, 'fc-1');
  assert.equal(session?.residentDigits, '01012345678');
});

test('FC graph session rejects tampered, mismatched, and expired values', () => {
  const value = createFcGraphSessionValue({
    fcId: 'fc-1',
    residentDigits: '01012345678',
    nowMs: NOW,
    ttlSeconds: 60,
    secret: SECRET,
  });

  assert.equal(
    verifyFcGraphSessionValue(`${value.slice(0, -1)}x`, {
      expectedResidentDigits: '01012345678',
      nowMs: NOW + 1000,
      secret: SECRET,
    }),
    null,
  );

  assert.equal(
    verifyFcGraphSessionValue(value, {
      expectedResidentDigits: '01000000000',
      nowMs: NOW + 1000,
      secret: SECRET,
    }),
    null,
  );

  assert.equal(
    verifyFcGraphSessionValue(value, {
      expectedResidentDigits: '01012345678',
      nowMs: NOW + 61_000,
      secret: SECRET,
    }),
    null,
  );
});
