import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatSessionResidentMask,
  isClientSessionReadOnly,
} from './client-session-restore.ts';

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
