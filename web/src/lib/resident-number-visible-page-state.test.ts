import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createVisiblePageResidentNumberScope,
  failVisiblePageResidentNumbers,
  resolveVisiblePageResidentNumbers,
  selectVisiblePageResidentNumberCells,
} from './resident-number-visible-page-state.ts';

test('visible-page scope changes for page, filter, or session changes and ignores stale results', () => {
  const firstScope = createVisiblePageResidentNumberScope({
    fcIds: ['fc-a', 'fc-b'],
    enabled: true,
    resetKey: 'page-1/filter-all/session-a',
  });
  const nextScope = createVisiblePageResidentNumberScope({
    fcIds: ['fc-a', 'fc-b'],
    enabled: true,
    resetKey: 'page-2/filter-pending/session-b',
  });
  const staleResult = failVisiblePageResidentNumbers(firstScope);

  assert.notEqual(firstScope.key, nextScope.key);
  assert.deepEqual(
    selectVisiblePageResidentNumberCells(nextScope, staleResult),
    nextScope.initialCells,
  );
  assert.equal(nextScope.initialCells['fc-a']?.status, 'loading');
});

test('visible-page scope refuses oversized requests before fetch', () => {
  const scope = createVisiblePageResidentNumberScope({
    fcIds: Array.from({ length: 21 }, (_, index) => `fc-${index + 1}`),
    enabled: true,
    resetKey: 'oversized',
  });

  assert.equal(scope.shouldFetch, false);
  assert.equal(Object.keys(scope.initialCells).length, 21);
  assert.equal(
    Object.values(scope.initialCells).every((cell) => cell.status === 'error'),
    true,
  );
});

test('visible-page resolution keeps full values in scope and fails closed per missing row', () => {
  const scope = createVisiblePageResidentNumberScope({
    fcIds: ['fc-ready', 'fc-missing'],
    enabled: true,
    resetKey: 'current',
  });
  const fullValue = `${'1'.repeat(6)}-${'2'.repeat(7)}`;
  const resolved = resolveVisiblePageResidentNumbers(scope, {
    'fc-ready': fullValue,
    'fc-missing': null,
  });

  assert.deepEqual(selectVisiblePageResidentNumberCells(scope, resolved), {
    'fc-ready': { status: 'ready', value: fullValue },
    'fc-missing': { status: 'unavailable' },
  });
});

test('disabled scope clears all cells and does not fetch', () => {
  const scope = createVisiblePageResidentNumberScope({
    fcIds: ['fc-a'],
    enabled: false,
    resetKey: 'logged-out',
  });

  assert.equal(scope.shouldFetch, false);
  assert.deepEqual(scope.initialCells, {});
});
