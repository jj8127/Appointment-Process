import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeResidentNumberRouteFcIds } from './resident-number-route-request.ts';

test('normalizes resident-number route fcIds with current trim/filter/dedupe contract', () => {
  assert.deepEqual(normalizeResidentNumberRouteFcIds(undefined), []);
  assert.deepEqual(normalizeResidentNumberRouteFcIds(null), []);
  assert.deepEqual(normalizeResidentNumberRouteFcIds('fc-1'), []);
  assert.deepEqual(normalizeResidentNumberRouteFcIds({ fcIds: ['fc-1'] }), []);

  assert.deepEqual(
    normalizeResidentNumberRouteFcIds([' fc-1 ', '', 'fc-2', null, undefined, 300, 'fc-1', '  300  ']),
    ['fc-1', 'fc-2', '300'],
  );
});
