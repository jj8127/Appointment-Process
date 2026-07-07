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

test('hub spokes render as quiet background links while branch links stay readable', () => {
  const root = makeNode('root', { referralCount: 24 });
  const rootLeaf = makeNode('root-leaf', { inboundCount: 1 });
  const branch = makeNode('branch', { inboundCount: 1, referralCount: 4 });
  const branchLeaf = makeNode('branch-leaf');

  const rootSpokeStyle = getReferralGraphLinkStyle(root, rootLeaf);
  const branchStyle = getReferralGraphLinkStyle(branch, branchLeaf);

  assert.equal(rootSpokeStyle.layer, 'background');
  assert.ok(rootSpokeStyle.alpha >= 0.28, `hub spoke should remain visible, got alpha=${rootSpokeStyle.alpha}`);
  assert.ok(rootSpokeStyle.alpha <= 0.36, `hub spoke should stay quieter than branches, got alpha=${rootSpokeStyle.alpha}`);
  assert.ok(rootSpokeStyle.width >= 0.9, `hub spoke should not disappear at overview zoom, got width=${rootSpokeStyle.width}`);
  assert.equal(branchStyle.layer, 'foreground');
  assert.ok(branchStyle.alpha > rootSpokeStyle.alpha, `branch link should be clearer than hub spoke`);
  assert.ok(branchStyle.alpha >= 0.44, `branch link should be readable, got alpha=${branchStyle.alpha}`);
  assert.ok(branchStyle.alpha <= 0.54, `branch link should stay below selected emphasis, got alpha=${branchStyle.alpha}`);
});

test('selected edges become the only strong relationship lines', () => {
  const root = makeNode('root', { referralCount: 24 });
  const leaf = makeNode('leaf');

  const regularStyle = getReferralGraphLinkStyle(root, leaf);
  const selectedStyle = getReferralGraphLinkStyle(root, leaf, { isSelectionEdge: true });

  assert.equal(selectedStyle.layer, 'foreground');
  assert.ok(selectedStyle.alpha >= 0.82, `selected edge should be prominent, got alpha=${selectedStyle.alpha}`);
  assert.ok(selectedStyle.width >= 1.6, `selected edge should be thicker, got width=${selectedStyle.width}`);
  assert.ok(selectedStyle.alpha > regularStyle.alpha);
});

test('render sort paints quiet background links before foreground branch links', () => {
  const root = makeNode('root', { referralCount: 24 });
  const branch = makeNode('branch', { inboundCount: 1, referralCount: 4 });
  const leaf = makeNode('leaf', { inboundCount: 1 });
  const nodesById = new Map([root, branch, leaf].map((node) => [node.id, node]));

  const sorted = sortReferralGraphLinksForRendering([
    { id: 'branch__leaf', referralCode: null, source: 'branch', target: 'leaf' },
    { id: 'root__branch', referralCode: null, source: 'root', target: 'branch' },
  ], nodesById);

  assert.deepEqual(sorted.map((edge) => edge.id), ['root__branch', 'branch__leaf']);
});
