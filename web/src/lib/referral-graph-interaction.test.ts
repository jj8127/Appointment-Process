import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  applyReferralGraphDragFollowerTranslation,
  buildReferralGraphAdjacency,
  buildReferralGraphDirectedChildren,
  getReferralGraphDescendantDepths,
  getReferralGraphDescendantNodeIds,
  getReferralGraphConnectedNodeIds,
  releaseReferralGraphDragFollowerNodes,
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

test('getReferralGraphDescendantNodeIds follows only directed child branches for drag followers', () => {
  const directedChildren = buildReferralGraphDirectedChildren([
    makeEdge('root', 'branch-a'),
    makeEdge('root', 'leaf-a'),
    makeEdge('branch-a', 'grandchild-a'),
    makeEdge('sibling-root', 'sibling-leaf'),
  ]);

  assert.deepEqual(
    [...getReferralGraphDescendantNodeIds('root', directedChildren)].sort(),
    ['branch-a', 'grandchild-a', 'leaf-a'],
  );
  assert.deepEqual(
    [...getReferralGraphDescendantNodeIds('branch-a', directedChildren)].sort(),
    ['grandchild-a'],
  );
  assert.deepEqual([...getReferralGraphDescendantNodeIds('leaf-a', directedChildren)], []);
});

test('getReferralGraphDescendantDepths tracks branch depth for non-rigid drag followers', () => {
  const directedChildren = buildReferralGraphDirectedChildren([
    makeEdge('root', 'child-a'),
    makeEdge('root', 'child-b'),
    makeEdge('child-a', 'grandchild-a'),
    makeEdge('grandchild-a', 'great-grandchild-a'),
    makeEdge('sibling-root', 'sibling-leaf'),
  ]);

  assert.deepEqual([...getReferralGraphDescendantDepths('root', directedChildren).entries()].sort(), [
    ['child-a', 1],
    ['child-b', 1],
    ['grandchild-a', 2],
    ['great-grandchild-a', 3],
  ]);
});

test('applyReferralGraphDragFollowerTranslation moves child followers without moving ancestors or siblings', () => {
  const nodesById = new Map([
    ['root', { id: 'root', x: 0, y: 0, vx: 2, vy: 2 }],
    ['branch-a', { id: 'branch-a', x: 100, y: 40, vx: 3, vy: 4 }],
    ['grandchild-a', { id: 'grandchild-a', x: 160, y: 80, vx: 1, vy: 2 }],
    ['sibling-root', { id: 'sibling-root', x: -50, y: -50, vx: 9, vy: 9 }],
  ]);
  const followers = new Set(['branch-a', 'grandchild-a']);

  const movedIds = applyReferralGraphDragFollowerTranslation(nodesById, followers, { x: 34, y: -12 });

  assert.deepEqual([...movedIds].sort(), ['branch-a', 'grandchild-a']);
  assert.deepEqual(nodesById.get('branch-a'), {
    id: 'branch-a',
    x: 134,
    y: 28,
    vx: 0,
    vy: 0,
    fx: 134,
    fy: 28,
  });
  assert.deepEqual(nodesById.get('grandchild-a'), {
    id: 'grandchild-a',
    x: 194,
    y: 68,
    vx: 0,
    vy: 0,
    fx: 194,
    fy: 68,
  });
  assert.deepEqual(nodesById.get('root'), { id: 'root', x: 0, y: 0, vx: 2, vy: 2 });
  assert.deepEqual(nodesById.get('sibling-root'), { id: 'sibling-root', x: -50, y: -50, vx: 9, vy: 9 });

  const releasedTargets = releaseReferralGraphDragFollowerNodes(nodesById, followers);

  assert.deepEqual([...releasedTargets.entries()].sort(), [
    ['branch-a', { x: 134, y: 28 }],
    ['grandchild-a', { x: 194, y: 68 }],
  ]);
  assert.equal(nodesById.get('branch-a')?.fx, undefined);
  assert.equal(nodesById.get('branch-a')?.fy, undefined);
  assert.equal(nodesById.get('grandchild-a')?.fx, undefined);
  assert.equal(nodesById.get('grandchild-a')?.fy, undefined);
});

test('applyReferralGraphDragFollowerTranslation dampens deep descendants so large branches do not move as one rigid body', () => {
  const nodesById = new Map([
    ['child-a', { id: 'child-a', x: 100, y: 0, vx: 5, vy: 5 }],
    ['grandchild-a', { id: 'grandchild-a', x: 200, y: 0, vx: 5, vy: 5 }],
    ['great-grandchild-a', { id: 'great-grandchild-a', x: 300, y: 0, vx: 5, vy: 5 }],
  ]);
  const followers = new Set(['child-a', 'grandchild-a', 'great-grandchild-a']);
  const depths = new Map([
    ['child-a', 1],
    ['grandchild-a', 2],
    ['great-grandchild-a', 3],
  ]);

  applyReferralGraphDragFollowerTranslation(nodesById, followers, { x: 100, y: 0 }, {
    depthByNodeId: depths,
    depthDecay: 0.5,
    directChildScale: 0.8,
    maxPinnedDepth: 1,
    minScale: 0.3,
  });

  assert.equal(nodesById.get('child-a')?.x, 180);
  assert.equal(nodesById.get('grandchild-a')?.x, 240);
  assert.equal(nodesById.get('great-grandchild-a')?.x, 330);
  assert.equal(nodesById.get('child-a')?.fx, 180);
  assert.equal(nodesById.get('grandchild-a')?.fx, undefined);
  assert.equal(nodesById.get('great-grandchild-a')?.fx, undefined);
});

test('ReferralGraphCanvas wires directed drag followers into node drag handlers', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');

  assert.match(source, /dragFollowerNodeIdsRef/);
  assert.match(source, /dragFollowerNodeDepthsRef/);
  assert.match(source, /buildReferralGraphDirectedChildren/);
  assert.match(source, /getReferralGraphDescendantDepths/);
  assert.match(source, /getReferralGraphDescendantNodeIds/);
  assert.match(source, /applyReferralGraphDragFollowerTranslation/);
  assert.match(source, /releaseReferralGraphDragFollowerNodes/);
  assert.match(source, /getReferralGraphDescendantNodeIds\(node\.id,\s*directedChildren\)/);
  assert.match(source, /maxPinnedDepth:\s*1/);
  assert.doesNotMatch(source, /handleNodeDrag[\s\S]+graphRef\.current\?\.d3ReheatSimulation\?\.\(\)/);
  assert.match(source, /dragMemorySuppressedNodeIdsRef\.current = new Set\(\[\s*\.\.\.userMovedNodeIdsRef\.current,\s*node\.id,\s*\.\.\.dragFollowerNodeIdsRef\.current,\s*\]\)/s);
  assert.match(source, /for \(const \[followerId,\s*target\] of followerTargets\)[\s\S]+userMovedNodeTargetsRef\.current\.set\(followerId,\s*target\)/);
});

test('ReferralGraphCanvas lowers reheat-sensitive forces during active drag', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');

  assert.match(source, /configureActiveDragForceMode\('drag'\)/);
  assert.match(source, /configureActiveDragForceMode\('settle'\)/);
  assert.match(source, /chargeForce\.strength\(mode === 'drag' \? 0 : physics\.chargeStrength\)/);
  assert.match(source, /collisionForce[\s\S]+\.strength\(mode === 'drag' \? 0\.04 : 0\.55\)/);
  assert.match(source, /collisionForce[\s\S]+\.iterations\(mode === 'drag' \? 1 : 3\)/);
});

test('ReferralGraphCanvas leaves mobile pinch zoom and pan to the graph renderer', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');

  assert.match(source, /window\.matchMedia\('\(hover: none\), \(pointer: coarse\)'\)/);
  assert.match(source, /enableZoomInteraction=\{useNativeViewportInteraction\}/);
  assert.match(source, /enablePanInteraction=\{useNativeViewportInteraction\}/);
  assert.match(source, /if \(useNativeViewportInteraction \|\| event\.pointerType !== 'mouse'\) return;/);
  assert.match(source, /const handleWheel = \(event: WheelEvent\) => \{\s*if \(useNativeViewportInteraction\) return;/);
});

test('ReferralGraphCanvas exposes graph runtime coordinates only for development visual QA', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');

  assert.match(source, /__referralGraphDebug/);
  assert.match(source, /process\.env\.NODE_ENV === 'production'[\s\S]+return/);
  assert.match(source, /graph2ScreenCoords/);
  assert.match(source, /screen2GraphCoords/);
  assert.match(source, /delete window\.__referralGraphDebug/);
});
