import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  applyReferralGraphDragFollowerTranslation,
  buildReferralGraphAdjacency,
  buildReferralGraphDirectedChildren,
  getReferralGraphDescendantDepths,
  getReferralGraphLocalDragDepths,
  getReferralGraphConnectedNodeIds,
} from './referral-graph-interaction.ts';
import type { ReferralGraphDragFollowerNode } from './referral-graph-interaction.ts';
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

test('getReferralGraphLocalDragDepths limits active drag influence to two hops', () => {
  const adjacency = buildReferralGraphAdjacency([
    makeEdge('root', 'direct-a'),
    makeEdge('direct-a', 'second-hop-a'),
    makeEdge('second-hop-a', 'third-hop-a'),
    makeEdge('root', 'direct-b'),
    makeEdge('other-root', 'other-leaf'),
  ]);

  assert.deepEqual([...getReferralGraphLocalDragDepths('root', adjacency, 2).entries()].sort(), [
    ['direct-a', 1],
    ['direct-b', 1],
    ['root', 0],
    ['second-hop-a', 2],
  ]);
});

test('getReferralGraphDescendantDepths follows only directed lower nodes', () => {
  const childrenByNodeId = buildReferralGraphDirectedChildren([
    makeEdge('root', 'child-a'),
    makeEdge('child-a', 'grand-child-a'),
    makeEdge('root', 'child-b'),
    makeEdge('parent', 'root'),
    makeEdge('other-root', 'other-child'),
  ]);

  assert.deepEqual([...getReferralGraphDescendantDepths('root', childrenByNodeId).entries()].sort(), [
    ['child-a', 1],
    ['child-b', 1],
    ['grand-child-a', 2],
  ]);
});

test('applyReferralGraphDragFollowerTranslation gives descendants elastic movement without pinning them', () => {
  const nodesById = new Map<string, ReferralGraphDragFollowerNode>([
    ['child', { id: 'child', x: 0, y: 0, vx: 9, vy: 9 }],
    ['grand-child', { id: 'grand-child', x: 0, y: 0, vx: 9, vy: 9 }],
  ]);
  const depthByNodeId = new Map([
    ['child', 1],
    ['grand-child', 2],
  ]);

  const moved = applyReferralGraphDragFollowerTranslation(
    nodesById,
    new Set(depthByNodeId.keys()),
    { x: 100, y: -50 },
    {
      depthByNodeId,
      depthDecay: 0.58,
      directChildScale: 0.42,
      maxPinnedDepth: 0,
      minScale: 0.04,
    },
  );

  assert.deepEqual([...moved].sort(), ['child', 'grand-child']);
  assert.equal(nodesById.get('child')?.x, 42);
  assert.equal(nodesById.get('child')?.y, -21);
  assert.equal(nodesById.get('child')?.fx, undefined);
  assert.equal(nodesById.get('child')?.fy, undefined);
  assert.equal(Math.round((nodesById.get('grand-child')?.x ?? 0) * 100) / 100, 24.36);
  assert.equal(Math.round((nodesById.get('grand-child')?.y ?? 0) * 100) / 100, -12.18);
});

test('ReferralGraphCanvas uses velocity-based rubber-band tethers instead of descendant teleporting', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');
  const dragHandler = source.slice(
    source.indexOf('const handleNodeDrag = useCallback'),
    source.indexOf('const handleNodeDragEnd = useCallback'),
  );
  const dragEndHandler = source.slice(
    source.indexOf('const handleNodeDragEnd = useCallback'),
    source.indexOf('const nodeLabel = useCallback'),
  );
  const finishNodeDragHandler = source.slice(
    source.indexOf('const finishNodeDrag = useCallback'),
    source.indexOf('useEffect(() => {', source.indexOf('const finishNodeDrag = useCallback')),
  );
  const pointerMoveHandler = source.slice(
    source.indexOf('const handlePointerMove = (event: PointerEvent) => {'),
    source.indexOf('const handlePointerUp = (event: PointerEvent) => {'),
  );

  assert.doesNotMatch(source, /dragFollowerNodeIdsRef/);
  assert.doesNotMatch(source, /dragFollowerNodeDepthsRef/);
  assert.doesNotMatch(source, /releaseReferralGraphDragFollowerNodes/);
  assert.doesNotMatch(source, /userMovedNodeTargetsRef/);
  assert.doesNotMatch(source, /buildReferralGraphDirectedChildren\(graphData\.links\)/);
  assert.doesNotMatch(source, /getReferralGraphDescendantDepths/);
  assert.doesNotMatch(source, /applyReferralGraphDragFollowerTranslation/);
  assert.doesNotMatch(source, /createReferralGraphDragElasticTetherForce/);
  assert.match(source, /createReferralGraphPointerDragForce/);
  assert.doesNotMatch(source, /elasticDragTethersRef/);
  assert.match(source, /pointerDragTargetRef/);
  assert.doesNotMatch(source, /buildElasticDragTethers/);
  assert.match(source, /fg\.d3Force\('drag-elastic-tether', null\)/);
  assert.doesNotMatch(dragHandler, /node\.x \+=/);
  assert.doesNotMatch(dragHandler, /node\.y \+=/);
  assert.doesNotMatch(pointerMoveHandler, /node\.x = nextGraphPosition\.x/);
  assert.doesNotMatch(pointerMoveHandler, /node\.y = nextGraphPosition\.y/);
  assert.doesNotMatch(pointerMoveHandler, /node\.fx = node\.x/);
  assert.doesNotMatch(pointerMoveHandler, /node\.fy = node\.y/);
  assert.doesNotMatch(pointerMoveHandler, /node\.vx = 0/);
  assert.doesNotMatch(pointerMoveHandler, /node\.vy = 0/);
  assert.match(pointerMoveHandler, /pointerDragTargetRef\.current = \{/);
  assert.match(pointerMoveHandler, /MAX_POINTER_DRAG_IMPULSE/);
  assert.doesNotMatch(dragHandler, /directChildScale/);
  assert.doesNotMatch(source, /__initialDragPos/);
  assert.doesNotMatch(source, /lastDragGraphPositionRef/);
  assert.match(source, /node\.fx = undefined;/);
  assert.match(source, /node\.fy = undefined;/);
  assert.match(source, /resumeAnimation\?\.\(\)/);
  assert.match(source, /GRAPH_MOTION_KEEP_ALIVE_MS/);
  assert.match(source, /startGraphMotionKeepAlive/);
  assert.match(source, /d3ReheatSimulation\?\.\(\)/);
  assert.match(source, /if \(alphaTarget > 0\)/);
  assert.doesNotMatch(dragHandler, /d3ReheatSimulation/);
  assert.doesNotMatch(dragEndHandler, /d3ReheatSimulation/);
  assert.match(source, /d3AlphaMin\?\.\(options\?\.allowColdStart \? 0 : REFERRAL_GRAPH_ENGINE_COOLDOWN\.alphaMin\)/);
  assert.match(source, /setGraphDragAlphaTarget\(physics\.dragReheatAlpha, \{ allowColdStart: true \}\)/);
  assert.doesNotMatch(dragEndHandler, /node\.vx = 0;/);
  assert.doesNotMatch(dragEndHandler, /node\.vy = 0;/);
  assert.match(source, /RELEASE_SETTLE_ALPHA/);
  assert.match(source, /RELEASE_SETTLE_MS/);
  assert.match(source, /RELEASE_POINTER_VELOCITY_TICK_MS/);
  assert.match(source, /RELEASE_VELOCITY_SCALE/);
  assert.match(finishNodeDragHandler, /setGraphDragAlphaTarget\(RELEASE_SETTLE_ALPHA, \{ allowColdStart: true \}\)/);
  assert.match(finishNodeDragHandler, /startGraphMotionKeepAlive\(\)/);
  assert.match(finishNodeDragHandler, /stopGraphMotionKeepAlive\(\)/);
  assert.match(source, /window\.setTimeout/);
  assert.match(source, /activeDragNodeDepthsRef\.current = getReferralGraphLocalDragDepths/);
});

test('ReferralGraphCanvas keeps spring, charge, and collision physics alive during active drag', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');

  assert.match(source, /resolveReferralGraphFreePhysics/);
  assert.doesNotMatch(source, /configureActiveDragForceMode\('drag'\)/);
  assert.doesNotMatch(source, /chargeForce\.strength\(mode === 'drag' \? 0 : physics\.chargeStrength\)/);
  assert.doesNotMatch(source, /strength\(mode === 'drag' \? 0\.04 : 0\.55\)/);
  assert.doesNotMatch(source, /iterations\(mode === 'drag' \? 1 : 3\)/);
  assert.doesNotMatch(source, /return 0;\s*\}\s*return 0;/);
  assert.doesNotMatch(source, /forceX<FGNode>/);
  assert.doesNotMatch(source, /forceY<FGNode>/);
  assert.match(source, /fg\.d3Force\('x', null\)/);
  assert.match(source, /fg\.d3Force\('y', null\)/);
  assert.match(source, /forceManyBody<FGNode>\(\)[\s\S]+\.strength\(physics\.chargeStrength\)/);
  assert.match(source, /forceCollide<FGNode>\(\)[\s\S]+\.strength\(physics\.collisionStrength\)/);
  assert.match(source, /fg\.d3Force\('layout-memory', null\)/);
  assert.match(source, /fg\.d3Force\('drag-spring', null\)/);
  assert.match(source, /fg\.d3Force\('component-cohesion', null\)/);
  assert.match(source, /fg\.d3Force\('edge-crossing', null\)/);
  assert.match(source, /createReferralGraphDragLocalityForce<RuntimeGraphNode>/);
  assert.match(source, /backgroundVelocityScale:\s*0/);
  assert.match(source, /directNeighborVelocityScale:\s*1/);
  assert.match(source, /secondHopVelocityScale:\s*1/);
  assert.match(source, /createReferralGraphPointerDragForce<RuntimeGraphNode>/);
  assert.doesNotMatch(source, /createReferralGraphLayoutMemoryForce\(/);
  assert.doesNotMatch(source, /createReferralGraphDragSpringForce\(/);
});

test('ReferralGraphCanvas leaves mobile pinch zoom and pan to the graph renderer', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');

  assert.match(source, /window\.matchMedia\('\(hover: none\), \(pointer: coarse\)'\)/);
  assert.match(source, /enableZoomInteraction=\{useNativeViewportInteraction\}/);
  assert.match(source, /enablePanInteraction=\{useNativeViewportInteraction\}/);
  assert.match(source, /if \(useNativeViewportInteraction \|\| event\.pointerType !== 'mouse'\) return;/);
  assert.match(source, /const handleWheel = \(event: WheelEvent\) => \{\s*if \(useNativeViewportInteraction\) return;/);
});

test('ReferralGraphCanvas uses force-graph canvas coordinates for desktop pan hit testing', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');

  assert.match(source, /const getCanvasPoint = useCallback\(\(event: PointerEvent \| WheelEvent, element: HTMLDivElement\) =>/);
  assert.match(source, /x: event\.clientX - rect\.left/);
  assert.match(source, /y: event\.clientY - rect\.top/);
  assert.match(source, /const graphPoint = fg\.screen2GraphCoords\(point\.x, point\.y\)/);
});

test('ReferralGraphCanvas keeps overview nodes easy to grab with a screen-sized hit area', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');

  assert.match(source, /const MIN_NODE_HIT_RADIUS_PX = 18/);
  assert.match(source, /function getNodeInteractionRadius/);
  assert.match(source, /const safeGlobalScale = Number\.isFinite\(globalScale\) \? globalScale : 1/);
  assert.match(source, /MIN_NODE_HIT_RADIUS_PX \/ Math\.max\(safeGlobalScale, 0\.1\)/);
  assert.ok(source.includes('const currentZoom = graphRef.current?.zoom?.() ?? 1'));
  assert.match(source, /getNodeInteractionRadius\(node, descendantCountByNodeId, currentZoom\)/);
  assert.match(source, /const nodePointerAreaPaint = useCallback\(\(rawNode: FGNode, paintColor: string, ctx: CanvasRenderingContext2D, globalScale: number\)/);
  assert.match(source, /getNodeInteractionRadius\(node, descendantCountByNodeId, globalScale\)/);
  assert.match(source, /sortReferralGraphNodesForRendering\(nodesCopy, descendantCountByNodeId\)/);
  assert.match(source, /getNodeInteractionPriority/);
});

test('ReferralGraphCanvas renders nodes and labels with the requested enlarged visual scale', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');

  assert.match(source, /const NODE_VISUAL_SCALE = 1\.25/);
  assert.match(source, /const LABEL_VISUAL_SCALE = 1\.25/);
  assert.match(source, /return getReferralGraphNodeRadius\(\{[\s\S]+descendantCount: descendantCountByNodeId\?\.get\(node\.id\) \?\? null,[\s\S]+\}\) \* NODE_VISUAL_SCALE;/);
  assert.match(source, /const fontSize = LABEL_VISUAL_SCALE \* Math\.max/);
  assert.match(source, /ctx\.lineWidth = \(3\.4 \* LABEL_VISUAL_SCALE\) \/ Math\.max/);
});

test('ReferralGraphCanvas handles desktop node dragging directly instead of relying on shadow-canvas drag', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');

  assert.match(source, /manualNodeDragStateRef/);
  assert.match(source, /findNodeAtGraphPoint/);
  assert.match(source, /beginNodeDrag\(node\)/);
  assert.match(source, /finishNodeDrag\(node/);
  assert.match(source, /pointerDragTargetRef\.current = \{/);
  assert.match(source, /pointerTravel < 5/);
  assert.match(source, /enableNodeDrag=\{false\}/);
});

test('ReferralGraphCanvas releases dragged nodes with spring momentum instead of freezing the dropped shape', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');
  const pointerMoveHandler = source.slice(
    source.indexOf('const handlePointerMove = (event: PointerEvent) => {'),
    source.indexOf('const handlePointerUp = (event: PointerEvent) => {'),
  );
  const pointerUpHandler = source.slice(
    source.indexOf('const handlePointerUp = (event: PointerEvent) => {'),
    source.indexOf('const handleWheel = (event: WheelEvent) => {'),
  );
  const finishNodeDragHandler = source.slice(
    source.indexOf('const finishNodeDrag = useCallback'),
    source.indexOf('useEffect(() => {', source.indexOf('const finishNodeDrag = useCallback')),
  );
  assert.doesNotMatch(source, /releaseElasticRootNodeIdRef/);
  assert.doesNotMatch(source, /createReferralGraphDragElasticTetherForce<RuntimeGraphNode>/);
  assert.doesNotMatch(source, /elasticDragTethersRef/);
  assert.match(source, /velocity: \{ x: number; y: number \}/);
  assert.match(source, /velocity: \{ x: 0, y: 0 \}/);
  assert.match(pointerMoveHandler, /const instantNodeVelocity = clampVector\(\{/);
  assert.match(pointerMoveHandler, /RELEASE_POINTER_VELOCITY_TICK_MS \/ dt/);
  assert.match(pointerMoveHandler, /nodeDragState\.velocity = clampVector\(\{/);
  assert.match(pointerUpHandler, /finishNodeDrag\(node, nodeDragState\.velocity\)/);
  assert.match(finishNodeDragHandler, /releaseVelocity: \{ x: number; y: number \}/);
  assert.match(finishNodeDragHandler, /const blendedReleaseVelocity = clampVector\(\{/);
  assert.match(finishNodeDragHandler, /releaseVelocity\.x \* RELEASE_VELOCITY_SCALE/);
  assert.match(finishNodeDragHandler, /releaseVelocity\.y \* RELEASE_VELOCITY_SCALE/);
  assert.match(finishNodeDragHandler, /node\.vx = blendedReleaseVelocity\.x/);
  assert.match(finishNodeDragHandler, /node\.vy = blendedReleaseVelocity\.y/);
  assert.match(finishNodeDragHandler, /pointerDragTargetRef\.current = null/);
  assert.match(finishNodeDragHandler, /releaseSettleTimerRef\.current = window\.setTimeout/);
  assert.match(source, /const activeRelease = releaseSettleTimerRef\.current != null/);
});

test('ReferralGraphCanvas exposes graph runtime coordinates only for development visual QA', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');

  assert.match(source, /__referralGraphDebug/);
  assert.match(source, /const shouldExposeDebug = \(/);
  assert.match(source, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(source, /window\.location\.hostname === 'localhost'/);
  assert.match(source, /window\.location\.hostname === '127\.0\.0\.1'/);
  assert.match(source, /if \(!shouldExposeDebug\) return;/);
  assert.match(source, /graph2ScreenCoords/);
  assert.match(source, /screen2GraphCoords/);
  assert.match(source, /clientX: screenPoint && canvasRect \? canvasRect\.x \+ screenPoint\.x : null/);
  assert.match(source, /clientY: screenPoint && canvasRect \? canvasRect\.y \+ screenPoint\.y : null/);
  assert.match(source, /getMetrics:/);
  assert.match(source, /maxVelocity/);
  assert.match(source, /totalKineticEnergy/);
  assert.match(source, /dataset\.referralGraphDebug/);
  assert.match(source, /activeDragDepths: \[\.\.\.activeDragNodeDepthsRef\.current\.entries\(\)\]/);
  assert.doesNotMatch(source, /elasticDragDepths/);
  assert.match(source, /graphRef\.current\?\.centerAt\?\.\(\)/);
  assert.match(source, /graphRef\.current\?\.zoom\?\.\(\)/);
  assert.match(source, /viewport: currentViewport/);
  assert.match(source, /setInterval\(writeDebugDataset/);
  assert.match(source, /delete window\.__referralGraphDebug/);
});

test('ReferralGraphCanvas clamps residual node velocity when the force engine stops', () => {
  const source = readFileSync('web/src/components/referrals/ReferralGraphCanvas.tsx', 'utf8');

  assert.match(source, /const handleEngineStop = useCallback/);
  assert.match(source, /nodeDragActiveRef\.current/);
  assert.match(source, /pointerDragTargetRef\.current/);
  assert.match(source, /releaseSettleTimerRef\.current != null/);
  assert.match(source, /node\.vx = 0;/);
  assert.match(source, /node\.vy = 0;/);
  assert.match(source, /autoPauseRedraw/);
  assert.match(source, /onEngineStop=\{handleEngineStop\}/);
});
