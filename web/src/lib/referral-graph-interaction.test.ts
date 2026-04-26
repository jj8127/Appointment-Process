import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReferralGraphAdjacency,
  getReferralGraphConnectedNodeIds,
} from './referral-graph-interaction.ts';
import type { GraphEdge } from '../types/referral-graph.ts';

function makeEdge(source: string, target: string): GraphEdge {
  return {
    id: `${source}__${target}`,
    source,
    target,
    referralCode: null,
  };
}

test('getReferralGraphConnectedNodeIds returns the whole connected component for drag memory suppression', () => {
  const adjacency = buildReferralGraphAdjacency([
    makeEdge('root', 'hub-a'),
    makeEdge('hub-a', 'leaf-a'),
    makeEdge('leaf-a', 'grand-leaf'),
    makeEdge('other-root', 'other-leaf'),
  ]);

  assert.deepEqual(
    [...getReferralGraphConnectedNodeIds('root', adjacency)].sort(),
    ['grand-leaf', 'hub-a', 'leaf-a', 'root'],
  );
  assert.deepEqual(
    [...getReferralGraphConnectedNodeIds('other-leaf', adjacency)].sort(),
    ['other-leaf', 'other-root'],
  );
});
