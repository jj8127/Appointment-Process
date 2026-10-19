import assert from 'node:assert/strict';
import test from 'node:test';

import { groupDocumentsByFc, resolveReviewSelection } from './admin-document-review.ts';

const doc = (id: string, fc_id: string, status = 'submitted') => ({ id, fc_id, status, created_at: '2026-10-19T00:00:00Z' });

test('documents group by FC in first-appearance order with pending counts', () => {
  const groups = groupDocumentsByFc([doc('a1', 'A'), doc('b1', 'B', 'approved'), doc('a2', 'A', 'pending'), doc('b2', 'B')]);
  assert.deepEqual(groups.map((group) => [group.fcId, group.docs.map((row) => row.id), group.pendingCount]), [
    ['A', ['a1', 'a2'], 2],
    ['B', ['b1', 'b2'], 1],
  ]);
});

test('selection keeps the chosen document and otherwise opens the first pending one', () => {
  const groups = groupDocumentsByFc([doc('a1', 'A', 'approved'), doc('a2', 'A'), doc('b1', 'B')]);
  assert.equal(resolveReviewSelection(groups, 'A', 'a1').doc?.id, 'a1');
  assert.equal(resolveReviewSelection(groups, 'A', null).doc?.id, 'a2');
  assert.equal(resolveReviewSelection(groups, 'B', 'gone').doc?.id, 'b1');
});

test('a handled document that leaves the list moves to the next one, then to the next FC', () => {
  // a1 was approved and dropped out of the 미처리 tab: a2 of the same FC opens.
  let groups = groupDocumentsByFc([doc('a2', 'A'), doc('b1', 'B')]);
  assert.deepEqual(Object.values(resolveReviewSelection(groups, 'A', 'a1')).map((value) => (value && 'fcId' in value ? value.fcId : value?.id)), ['A', 'a2']);
  // FC A has nothing left: the FC that took its place (B) opens.
  groups = groupDocumentsByFc([doc('b1', 'B'), doc('c1', 'C')]);
  const next = resolveReviewSelection(groups, 'A', 'a2', 0);
  assert.equal(next.group?.fcId, 'B');
  assert.equal(next.doc?.id, 'b1');
  // The last FC was handled: stay on the new last FC instead of jumping to the top.
  assert.equal(resolveReviewSelection(groups, 'Z', null, 5).group?.fcId, 'C');
  assert.deepEqual(resolveReviewSelection([], 'A', 'a1'), { group: null, doc: null });
});
