import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReferralGraphEdges } from './referral-graph-edges.ts';

test('buildReferralGraphEdges creates a single linked edge per valid structured recommender link', () => {
  const edges = buildReferralGraphEdges([
    { id: 'root', recommender_fc_id: null },
    { id: 'child-a', recommender_fc_id: 'root' },
    { id: 'child-b', recommender_fc_id: 'root' },
  ]);

  assert.deepStrictEqual(edges, [
    {
      id: 'root__child-a',
      source: 'root',
      target: 'child-a',
      referralCode: null,
    },
    {
      id: 'root__child-b',
      source: 'root',
      target: 'child-b',
      referralCode: null,
    },
  ]);
});

test('buildReferralGraphEdges ignores self-links, unknown parents, and duplicate child rows', () => {
  const edges = buildReferralGraphEdges([
    { id: 'root', recommender_fc_id: null },
    { id: 'child-a', recommender_fc_id: 'root' },
    { id: 'child-a', recommender_fc_id: 'root' },
    { id: 'child-b', recommender_fc_id: 'missing-parent' },
    { id: 'self-linked', recommender_fc_id: 'self-linked' },
  ]);

  assert.deepStrictEqual(edges, [
    {
      id: 'root__child-a',
      source: 'root',
      target: 'child-a',
      referralCode: null,
    },
  ]);
});
