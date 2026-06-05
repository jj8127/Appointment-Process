import assert from 'node:assert/strict';
import test from 'node:test';

import type { GraphNode } from '../types/referral-graph.ts';
import { getReferralGraphLinkStyle, sortReferralGraphLinksForRendering } from './referral-graph-link-style.ts';

function makeNode(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    activeCode: null,
    affiliation: '',
    allCommissionsCompleted: false,
    hasLegacyUnresolved: false,
    highlightType: null,
    id,
    inboundCount: 0,
    isIsolated: false,
    name: id,
    nodeStatus: 'has_active_code',
    phone: '',
    referralCount: 0,
    signupCompleted: true,
    ...overrides,
  };
}

test('regular graph edges render with one consistent visible style', () => {
  const root = makeNode('root', { referralCount: 24 });
  const rootLeaf = makeNode('root-leaf', { inboundCount: 1 });
  const branch = makeNode('branch', { inboundCount: 1, referralCount: 4 });
  const branchLeaf = makeNode('branch-leaf');

  const rootSpokeStyle = getReferralGraphLinkStyle(root, rootLeaf);
  const branchStyle = getReferralGraphLinkStyle(branch, branchLeaf);

  assert.deepEqual(rootSpokeStyle, branchStyle);
  assert.equal(rootSpokeStyle.layer, 'foreground');
  assert.ok(rootSpokeStyle.alpha >= 0.6, `edge should be visible, got alpha=${rootSpokeStyle.alpha}`);
  assert.ok(rootSpokeStyle.width >= 1.15, `edge should be visible, got width=${rootSpokeStyle.width}`);
});

test('selected edges keep the same stroke color and width contract as regular edges', () => {
  const root = makeNode('root', { referralCount: 24 });
  const leaf = makeNode('leaf');

  const regularStyle = getReferralGraphLinkStyle(root, leaf);
  const selectedStyle = getReferralGraphLinkStyle(root, leaf, { isSelectionEdge: true });

  assert.deepEqual(selectedStyle, regularStyle);
});

test('render sort is deterministic when every edge uses the same layer', () => {
  const root = makeNode('root', { referralCount: 24 });
  const branch = makeNode('branch', { inboundCount: 1, referralCount: 4 });
  const leaf = makeNode('leaf', { inboundCount: 1 });
  const nodesById = new Map([root, branch, leaf].map((node) => [node.id, node]));

  const sorted = sortReferralGraphLinksForRendering([
    { id: 'branch__leaf', referralCode: null, source: 'branch', target: 'leaf' },
    { id: 'root__branch', referralCode: null, source: 'root', target: 'branch' },
  ], nodesById);

  assert.deepEqual(sorted.map((edge) => edge.id), ['branch__leaf', 'root__branch']);
});
