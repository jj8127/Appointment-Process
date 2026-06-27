import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatSessionResidentMask,
  isClientSessionReadOnly,
  resolveClientSessionRestore,
} from './client-session-restore.ts';

const cookieSession = {
  role: 'manager' as const,
  residentId: '010-1111-2222',
  residentMask: '010-1111-2222',
  displayName: '쿠키 본부장',
  staffType: null,
};

const storageSession = {
  role: 'admin' as const,
  residentId: '01033334444',
  residentMask: '010-3333-4444',
  displayName: '스토리지 총무',
  staffType: 'admin' as const,
};

test('restores the cookie session before the localStorage session', () => {
  assert.deepEqual(
    resolveClientSessionRestore({
      cookieSession,
      storageSession,
    }),
    cookieSession,
  );
});

test('does not revive a localStorage session when the cookie session is missing', () => {
  assert.equal(
    resolveClientSessionRestore({
      cookieSession: null,
      storageSession,
    }),
    null,
  );
  assert.equal(
    resolveClientSessionRestore({
      cookieSession: null,
      storageSession: null,
    }),
    null,
  );
});

test('formats session resident masks with current grouping behavior', () => {
  assert.equal(formatSessionResidentMask(''), '');
  assert.equal(formatSessionResidentMask('010'), '010');
  assert.equal(formatSessionResidentMask('0101234'), '010-1234');
  assert.equal(formatSessionResidentMask('01012345678'), '010-1234-5678');
  assert.equal(formatSessionResidentMask('010-1234-5678'), '010-1234-5678');
  assert.equal(formatSessionResidentMask(' phone:01012345678 '), '010-1234-5678');
});

test('keeps manager as the only client read-only role', () => {
  assert.equal(isClientSessionReadOnly('manager'), true);
  assert.equal(isClientSessionReadOnly('admin'), false);
  assert.equal(isClientSessionReadOnly('fc'), false);
  assert.equal(isClientSessionReadOnly(null), false);
});
