import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReferralGraphDescendantCountMap } from './referral-graph-descendants.ts';
import type { GraphEdge, GraphNode } from '../types/referral-graph.ts';

function makeNode(id: string): Pick<GraphNode, 'id'> {
  return { id };
}

function makeEdge(source: string, target: string): GraphEdge {
  return {
    id: `${source}__${target}`,
    source,
    target,
    referralCode: null,
  };
}

test('buildReferralGraphDescendantCountMap counts all downstream descendants in a chain', () => {
  const counts = buildReferralGraphDescendantCountMap(
    [makeNode('root'), makeNode('branch'), makeNode('leaf')],
    [makeEdge('root', 'branch'), makeEdge('branch', 'leaf')],
  );

  assert.equal(counts.get('root'), 2);
  assert.equal(counts.get('branch'), 1);
  assert.equal(counts.get('leaf'), 0);
});

test('buildReferralGraphDescendantCountMap counts branching descendants without including the node itself', () => {
  const counts = buildReferralGraphDescendantCountMap(
    [makeNode('root'), makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
    [
      makeEdge('root', 'a'),
      makeEdge('root', 'b'),
      makeEdge('a', 'c'),
      makeEdge('b', 'd'),
    ],
  );

  assert.equal(counts.get('root'), 4);
  assert.equal(counts.get('a'), 1);
  assert.equal(counts.get('b'), 1);
});

test('buildReferralGraphDescendantCountMap is cycle-safe', () => {
  const counts = buildReferralGraphDescendantCountMap(
    [makeNode('a'), makeNode('b'), makeNode('self')],
    [
      makeEdge('a', 'b'),
      makeEdge('b', 'a'),
      makeEdge('self', 'self'),
    ],
  );

  assert.equal(counts.get('a'), 1);
  assert.equal(counts.get('b'), 1);
  assert.equal(counts.get('self'), 0);
});

test('buildReferralGraphDescendantCountMap ignores edges with missing endpoints', () => {
  const counts = buildReferralGraphDescendantCountMap(
    [makeNode('root'), makeNode('child')],
    [
      makeEdge('root', 'child'),
      makeEdge('root', 'missing'),
      makeEdge('missing-parent', 'child'),
    ],
  );

  assert.equal(counts.get('root'), 1);
  assert.equal(counts.get('child'), 0);
  assert.equal(counts.has('missing'), false);
});
