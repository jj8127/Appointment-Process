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

test('root hub direct spokes render as quieter background edges', () => {
  const root = makeNode('root', { referralCount: 24 });
  const leaf = makeNode('leaf', { inboundCount: 1 });

  const style = getReferralGraphLinkStyle(root, leaf);

  assert.equal(style.layer, 'background');
  assert.ok(style.alpha < 0.36, `root spoke should be visually quieter: ${style.alpha}`);
  assert.ok(style.width < 1, `root spoke should be thinner: ${style.width}`);
});

test('branch-local edges render above root spokes for group readability', () => {
  const branch = makeNode('branch', { inboundCount: 1, referralCount: 4 });
  const leaf = makeNode('leaf');

  const style = getReferralGraphLinkStyle(branch, leaf);

  assert.equal(style.layer, 'foreground');
  assert.ok(style.alpha >= 0.46, `branch edge should remain readable: ${style.alpha}`);
  assert.ok(style.width >= 1, `branch edge should remain normal width: ${style.width}`);
});

test('selected root spokes regain focus styling', () => {
  const root = makeNode('root', { referralCount: 24 });
  const leaf = makeNode('leaf');

  const style = getReferralGraphLinkStyle(root, leaf, { isSelectionEdge: true });

  assert.equal(style.layer, 'foreground');
  assert.ok(style.alpha >= 0.78, `selected edge should be prominent: ${style.alpha}`);
  assert.ok(style.width > 1.3, `selected edge should be thicker: ${style.width}`);
});

test('render sort draws root spokes before branch-local edges', () => {
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
