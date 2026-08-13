import { REFERRAL_REVENUE_DEMO_RAW_NODES } from '@/data/referral-revenue-demo';
import {
  buildSampleRevenueGraphLayout,
  formatCompactSampleRevenueKrw,
  formatSampleRevenueNodeAmount,
  getSampleRevenueContributionPath,
  getSampleRevenueGraphFitViewport,
  getSampleRevenueGraphNodeColor,
  getSampleRevenueGraphNodeRadius,
  getSampleRevenueGraphRadialTargetRadius,
  prepareSampleRevenueGraphPhysicsTopology,
  SAMPLE_REVENUE_ADMIN_WEB_PHYSICS,
  SAMPLE_REVENUE_GRAPH_GUIDE_DEPTHS,
  SAMPLE_REVENUE_GRAPH_MIN_SCALE,
  SAMPLE_REVENUE_GRAPH_SURFACE_CENTER,
  SAMPLE_REVENUE_GRAPH_SURFACE_SIZE,
  SAMPLE_REVENUE_MOBILE_SETTLE,
  SAMPLE_REVENUE_RADIAL_GUIDANCE,
  type SampleRevenueGraphPoint,
  stepSampleRevenueInteractivePhysics,
} from '@/lib/referral-revenue-graph-native';
import { buildSampleRevenueGraphModel } from '@/lib/referral-revenue-demo';
import type { SampleRevenueGraphEdge } from '@/types/referral-revenue-graph';

const model = buildSampleRevenueGraphModel(REFERRAL_REVENUE_DEMO_RAW_NODES);

const normalizeRadians = (angle: number) => (
  ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
    - Math.PI
);

function countDisjointEdgeCrossings(
  positions: ReadonlyMap<string, SampleRevenueGraphPoint>,
  edges: readonly SampleRevenueGraphEdge[],
) {
  const cross = (
    first: SampleRevenueGraphPoint,
    second: SampleRevenueGraphPoint,
    third: SampleRevenueGraphPoint,
  ) => (
    (second.x - first.x) * (third.y - first.y)
      - (second.y - first.y) * (third.x - first.x)
  );
  let crossings = 0;

  for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
    const left = edges[leftIndex];
    const leftSource = positions.get(left.source);
    const leftTarget = positions.get(left.target);
    if (!leftSource || !leftTarget) continue;

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < edges.length;
      rightIndex += 1
    ) {
      const right = edges[rightIndex];
      if (
        left.source === right.source
        || left.source === right.target
        || left.target === right.source
        || left.target === right.target
      ) {
        continue;
      }
      const rightSource = positions.get(right.source);
      const rightTarget = positions.get(right.target);
      if (!rightSource || !rightTarget) continue;
      const leftSides = cross(leftSource, leftTarget, rightSource)
        * cross(leftSource, leftTarget, rightTarget);
      const rightSides = cross(rightSource, rightTarget, leftSource)
        * cross(rightSource, rightTarget, leftTarget);
      if (leftSides < -1e-6 && rightSides < -1e-6) crossings += 1;
    }
  }

  return crossings;
}

function getChainEdgeDirections(
  positions: ReadonlyMap<string, SampleRevenueGraphPoint>,
  nodeIds: readonly string[],
) {
  return nodeIds.slice(1).map((nodeId, index) => {
    const source = positions.get(nodeIds[index])!;
    const target = positions.get(nodeId)!;
    return Math.atan2(target.y - source.y, target.x - source.x);
  });
}

describe('sample revenue native node-edge graph', () => {
  it('places every node deterministically around the viewer', () => {
    const first = buildSampleRevenueGraphLayout(model.nodes, model.edges);
    const second = buildSampleRevenueGraphLayout(model.nodes, model.edges);

    expect(first.size).toBe(model.nodes.length);
    expect(Array.from(first.entries())).toEqual(Array.from(second.entries()));
    expect(first.get('sample-viewer')).toEqual({
      x: SAMPLE_REVENUE_GRAPH_SURFACE_CENTER,
      y: SAMPLE_REVENUE_GRAPH_SURFACE_CENTER,
    });

    for (const point of first.values()) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(SAMPLE_REVENUE_GRAPH_SURFACE_SIZE);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(SAMPLE_REVENUE_GRAPH_SURFACE_SIZE);
    }
  });

  it('keeps the administrator balanced values as an auditable mobile baseline', () => {
    expect(SAMPLE_REVENUE_ADMIN_WEB_PHYSICS).toEqual({
      alphaDecay: 0.016,
      velocityDecay: 0.46,
      centerStrength: 0.024,
      chargeStrength: -141,
      chargeDistanceMin: 22,
      chargeDistanceMax: 538,
      linkDistance: 195,
      linkStrength: 0.54,
      collisionPadding: 34,
      collisionStrength: 0.88,
      collisionIterations: 2,
      linkTensionStrength: 0.18,
      linkTensionThresholdMultiplier: 1.38,
    });
    expect(SAMPLE_REVENUE_RADIAL_GUIDANCE).toEqual({
      targetStrength: 0.012,
      targetMaxImpulse: 8,
      viewerAnchorStrength: 0.18,
      viewerAnchorMaxImpulse: 18,
    });
    expect(SAMPLE_REVENUE_MOBILE_SETTLE).toEqual({
      initialAlpha: 0.32,
      decayMultiplier: 0.94,
      stopThreshold: 0.014,
    });
  });

  it('settles every pair without node collision overlap', () => {
    const topology = prepareSampleRevenueGraphPhysicsTopology(
      model.nodes,
      model.edges,
    );
    const positions = buildSampleRevenueGraphLayout(
      model.nodes,
      model.edges,
      topology,
    );
    const collisionRadiusById = new Map(
      topology.nodes.map(({ node, collisionRadius }) => [
        node.id,
        collisionRadius,
      ]),
    );
    const positionedNodes = model.nodes.map((node) => ({
      node,
      point: positions.get(node.id)!,
    }));

    for (let leftIndex = 0; leftIndex < positionedNodes.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < positionedNodes.length;
        rightIndex += 1
      ) {
        const left = positionedNodes[leftIndex];
        const right = positionedNodes[rightIndex];
        expect(Math.hypot(
          left.point.x - right.point.x,
          left.point.y - right.point.y,
        )).toBeGreaterThanOrEqual(
          collisionRadiusById.get(left.node.id)!
            + collisionRadiusById.get(right.node.id)!
            + 5
            - 1e-6,
        );
      }
    }
  });

  it('lets a dragged node push and pull its neighbors with live physics', () => {
    const topology = prepareSampleRevenueGraphPhysicsTopology(
      model.nodes,
      model.edges,
    );
    const positions = buildSampleRevenueGraphLayout(
      model.nodes,
      model.edges,
      topology,
    );
    const motion = new Map(Array.from(positions, ([id, point]) => [
      id,
      { ...point, vx: 0, vy: 0 },
    ]));
    const draggedStart = positions.get('sample-a1')!;
    const neighborStart = positions.get('sample-a2')!;
    const fixedPosition = {
      x: draggedStart.x + 180,
      y: draggedStart.y + 90,
    };
    const next = stepSampleRevenueInteractivePhysics({
      nodes: model.nodes,
      edges: model.edges,
      topology,
      motion,
      alpha: 0.24,
      ticks: 3,
      fixedNodeId: 'sample-a1',
      fixedPosition,
    });

    expect(next.get('sample-a1')).toMatchObject(fixedPosition);
    expect(next.get('sample-a1')).toMatchObject({ vx: 0, vy: 0 });
    expect(next.get('sample-a2')).not.toMatchObject({
      x: neighborStart.x,
      y: neighborStart.y,
    });
    expect({
      x: next.get('sample-a2')!.x - neighborStart.x,
      y: next.get('sample-a2')!.y - neighborStart.y,
    }).not.toEqual({
      x: fixedPosition.x - draggedStart.x,
      y: fixedPosition.y - draggedStart.y,
    });
  });

  it('does not clamp released graph coordinates to the seed surface', () => {
    const topology = prepareSampleRevenueGraphPhysicsTopology(
      model.nodes,
      model.edges,
    );
    const positions = buildSampleRevenueGraphLayout(
      model.nodes,
      model.edges,
      topology,
    );
    const translatedMotion = new Map(Array.from(positions, ([id, point]) => [
      id,
      {
        x: point.x + SAMPLE_REVENUE_GRAPH_SURFACE_SIZE * 2,
        y: point.y - SAMPLE_REVENUE_GRAPH_SURFACE_SIZE * 2,
        vx: 0,
        vy: 0,
      },
    ]));

    const next = stepSampleRevenueInteractivePhysics({
      nodes: model.nodes,
      edges: model.edges,
      topology,
      motion: translatedMotion,
      alpha: 0.001,
      ticks: 1,
    });

    expect(Math.min(...Array.from(next.values(), ({ x }) => x)))
      .toBeGreaterThan(SAMPLE_REVENUE_GRAPH_SURFACE_SIZE);
    expect(Math.max(...Array.from(next.values(), ({ y }) => y)))
      .toBeLessThan(0);
  });

  it('smoothly recenters the viewer over the exact release schedule', () => {
    const topology = prepareSampleRevenueGraphPhysicsTopology(
      model.nodes,
      model.edges,
    );
    const positions = buildSampleRevenueGraphLayout(
      model.nodes,
      model.edges,
      topology,
    );
    const motion = new Map(Array.from(positions, ([id, point]) => [
      id,
      { ...point, vx: 0, vy: 0 },
    ]));
    const draggedStart = positions.get('sample-a1')!;
    const fixedPosition = {
      x: draggedStart.x + 180,
      y: draggedStart.y + 90,
    };
    let releaseMotion = stepSampleRevenueInteractivePhysics({
      nodes: model.nodes,
      edges: model.edges,
      topology,
      motion,
      alpha: 0.24,
      ticks: 3,
      fixedNodeId: 'sample-a1',
      fixedPosition,
    });
    const releaseStartVector = {
      x: releaseMotion.get('sample-a2')!.x
        - releaseMotion.get('sample-a1')!.x,
      y: releaseMotion.get('sample-a2')!.y
        - releaseMotion.get('sample-a1')!.y,
    };

    let settleAlpha = SAMPLE_REVENUE_MOBILE_SETTLE.initialAlpha;
    let frameCount = 0;
    while (settleAlpha > SAMPLE_REVENUE_MOBILE_SETTLE.stopThreshold) {
      settleAlpha *= SAMPLE_REVENUE_MOBILE_SETTLE.decayMultiplier;
      releaseMotion = stepSampleRevenueInteractivePhysics({
        nodes: model.nodes,
        edges: model.edges,
        topology,
        motion: releaseMotion,
        alpha: settleAlpha,
        ticks: 1,
        fixedNodeId: null,
        fixedPosition: null,
      });
      frameCount += 1;
    }

    const viewer = releaseMotion.get('sample-viewer')!;
    expect(frameCount).toBe(51);
    expect(Math.hypot(
      viewer.x - SAMPLE_REVENUE_GRAPH_SURFACE_CENTER,
      viewer.y - SAMPLE_REVENUE_GRAPH_SURFACE_CENTER,
    )).toBeLessThanOrEqual(1);
    expect(releaseMotion.get('sample-a1')).not.toMatchObject(fixedPosition);
    expect({
      x: releaseMotion.get('sample-a2')!.x
        - releaseMotion.get('sample-a1')!.x,
      y: releaseMotion.get('sample-a2')!.y
        - releaseMotion.get('sample-a1')!.y,
    }).not.toEqual(releaseStartVector);
  });

  it('prepares reusable graph topology metadata for interactive frames', () => {
    const topology = prepareSampleRevenueGraphPhysicsTopology(
      model.nodes,
      model.edges,
    );

    expect(topology.nodes).toHaveLength(model.nodes.length);
    expect(topology.edges).toHaveLength(model.edges.length);
    expect(topology.nodes.map(({ node }) => node.id)).toEqual(
      [...model.nodes]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((node) => node.id),
    );
    expect(topology.edges.every((edge) => (
      Number.isFinite(edge.distance) && Number.isFinite(edge.strength)
    ))).toBe(true);
    expect(topology.viewerId).toBe('sample-viewer');
    expect(topology.nodes.every(({ radialTarget }) => (
      Object.keys(radialTarget).sort().join(',')
        === 'angle,branchIndex,offsetX,offsetY,radius'
      && Object.values(radialTarget).every(Number.isFinite)
    ))).toBe(true);
  });

  it('keeps every visible edge connected to two distinct positions', () => {
    const positions = buildSampleRevenueGraphLayout(model.nodes, model.edges);

    for (const edge of model.edges) {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);

      expect(source).toBeDefined();
      expect(target).toBeDefined();
      expect(source).not.toEqual(target);
    }
  });

  it('gives the three viewer branches distinct radial directions', () => {
    const topology = prepareSampleRevenueGraphPhysicsTopology(
      model.nodes,
      model.edges,
    );
    const reorderedTopology = prepareSampleRevenueGraphPhysicsTopology(
      [...model.nodes].reverse(),
      [...model.edges].reverse(),
    );
    const targetById = new Map(topology.nodes.map(({ node, radialTarget }) => [
      node.id,
      radialTarget,
    ]));
    const reorderedTargetById = new Map(
      reorderedTopology.nodes.map(({ node, radialTarget }) => [
        node.id,
        radialTarget,
      ]),
    );
    const firstLevelTargets = ['sample-a1', 'sample-b1', 'sample-c1']
      .map((id) => targetById.get(id)!);

    expect(firstLevelTargets.map(({ branchIndex }) => branchIndex))
      .toEqual([0, 1, 2]);
    expect(new Set(firstLevelTargets.map(({ angle }) => angle)).size).toBe(3);
    expect(reorderedTargetById).toEqual(targetById);
    expect(targetById.get('sample-a10')?.branchIndex).toBe(0);
    expect(targetById.get('sample-b3')?.branchIndex).toBe(1);
    expect(targetById.get('sample-c2')?.branchIndex).toBe(2);
    const landscapeBranchAngles = Array.from(
      { length: 11 },
      (_, index) => targetById.get(`sample-a${index + 1}`)!.angle,
    );
    const angularSteps = landscapeBranchAngles.slice(1).map(
      (angle, index) => normalizeRadians(angle - landscapeBranchAngles[index]),
    );
    expect(angularSteps.every((step) => step > 0)).toBe(true);
    expect(Math.max(...angularSteps)).toBeLessThan(Math.PI / 2);
  });

  it('keeps the canonical seed and normal settle visually untangled', () => {
    const topology = prepareSampleRevenueGraphPhysicsTopology(
      model.nodes,
      model.edges,
    );
    const positions = buildSampleRevenueGraphLayout(
      model.nodes,
      model.edges,
      topology,
    );
    const aChainIds = [
      'sample-viewer',
      ...Array.from({ length: 11 }, (_, index) => `sample-a${index + 1}`),
    ];
    const initialDirections = getChainEdgeDirections(positions, aChainIds);
    const postRootTurns = initialDirections.slice(2).map(
      (direction, index) => Math.abs(normalizeRadians(
        direction - initialDirections[index + 1],
      )),
    );

    expect(countDisjointEdgeCrossings(positions, model.edges)).toBe(0);
    expect(Math.max(...postRootTurns)).toBeLessThanOrEqual(Math.PI / 4);

    let settleAlpha = SAMPLE_REVENUE_MOBILE_SETTLE.initialAlpha;
    let settledMotion = new Map(Array.from(positions, ([id, point]) => [
      id,
      { ...point, vx: 0, vy: 0 },
    ]));
    while (settleAlpha > SAMPLE_REVENUE_MOBILE_SETTLE.stopThreshold) {
      settleAlpha *= SAMPLE_REVENUE_MOBILE_SETTLE.decayMultiplier;
      settledMotion = stepSampleRevenueInteractivePhysics({
        nodes: model.nodes,
        edges: model.edges,
        topology,
        motion: settledMotion,
        alpha: settleAlpha,
        ticks: 1,
      });
    }

    expect(countDisjointEdgeCrossings(settledMotion, model.edges)).toBe(0);
  });

  it('keeps every settled branch edge radially outward with collision room', () => {
    expect(SAMPLE_REVENUE_GRAPH_GUIDE_DEPTHS).toEqual([1, 3, 6, 10]);
    const topology = prepareSampleRevenueGraphPhysicsTopology(
      model.nodes,
      model.edges,
    );
    const topologyNodeById = new Map(
      topology.nodes.map((entry) => [
        entry.node.id,
        entry,
      ]),
    );
    const radialTargetById = new Map(topology.nodes.map(
      ({ node, radialTarget }) => [
        node.id,
        radialTarget,
      ],
    ));
    const depthNodes = Array.from(
      { length: 11 },
      (_, index) => `sample-a${index + 1}`,
    );
    const targetRadii = depthNodes.map(
      (nodeId) => radialTargetById.get(nodeId)!.radius,
    );
    expect(targetRadii).toEqual(
      Array.from(
        { length: 11 },
        (_, index) => getSampleRevenueGraphRadialTargetRadius(index + 1),
      ),
    );
    for (let index = 1; index < targetRadii.length; index += 1) {
      expect(targetRadii[index]).toBeGreaterThan(targetRadii[index - 1]);
    }

    const positions = buildSampleRevenueGraphLayout(
      model.nodes,
      model.edges,
      topology,
    );
    for (const { node, radialTarget } of topology.nodes) {
      expect(positions.get(node.id)).toEqual({
        x: SAMPLE_REVENUE_GRAPH_SURFACE_CENTER + radialTarget.offsetX,
        y: SAMPLE_REVENUE_GRAPH_SURFACE_CENTER + radialTarget.offsetY,
      });
    }
    const viewerPoint = positions.get('sample-viewer')!;
    const settledRadius = (nodeId: string) => {
      const point = positions.get(nodeId)!;
      return Math.hypot(point.x - viewerPoint.x, point.y - viewerPoint.y);
    };

    for (const edge of topology.edges) {
      const source = topologyNodeById.get(edge.sourceId)!;
      const target = topologyNodeById.get(edge.targetId)!;
      if (
        !source.node.isViewer
        && source.radialTarget.branchIndex !== target.radialTarget.branchIndex
      ) {
        continue;
      }
      expect(settledRadius(target.node.id)).toBeGreaterThan(
        settledRadius(source.node.id) + 5,
      );
      const sourcePoint = positions.get(source.node.id)!;
      const targetPoint = positions.get(target.node.id)!;
      expect(Math.hypot(
        targetPoint.x - sourcePoint.x,
        targetPoint.y - sourcePoint.y,
      )).toBeGreaterThanOrEqual(
        source.collisionRadius + target.collisionRadius + 5 - 1e-6,
      );
    }
  });

  it('returns eligible contribution edges from child inward to the viewer', () => {
    const path = getSampleRevenueContributionPath(
      'sample-a10',
      model.nodes,
      model.edges,
    );

    expect(path).toHaveLength(10);
    expect(path.map(({ target }) => target)).toEqual([
      'sample-a10',
      'sample-a9',
      'sample-a8',
      'sample-a7',
      'sample-a6',
      'sample-a5',
      'sample-a4',
      'sample-a3',
      'sample-a2',
      'sample-a1',
    ]);
    expect(path.map(({ source }) => source)).toEqual([
      'sample-a9',
      'sample-a8',
      'sample-a7',
      'sample-a6',
      'sample-a5',
      'sample-a4',
      'sample-a3',
      'sample-a2',
      'sample-a1',
      'sample-viewer',
    ]);
    expect(getSampleRevenueContributionPath(
      'sample-a11',
      model.nodes,
      model.edges,
    )).toEqual([]);
  });

  it('fits every padded node inside the actual landscape viewport insets', () => {
    const positions = buildSampleRevenueGraphLayout(model.nodes, model.edges);
    const width = 800;
    const height = 360;
    const insets = {
      top: 70,
      right: 16,
      bottom: 18,
      left: 16,
    };
    const viewport = getSampleRevenueGraphFitViewport({
      nodes: model.nodes,
      positions,
      width,
      height,
      insets,
    });

    expect(viewport.scale).toBeGreaterThan(0);
    expect(SAMPLE_REVENUE_GRAPH_MIN_SCALE).toBe(0.18);
    expect(viewport.scale).toBeGreaterThanOrEqual(
      SAMPLE_REVENUE_GRAPH_MIN_SCALE,
    );
    expect(Number.isFinite(viewport.panX)).toBe(true);
    expect(Number.isFinite(viewport.panY)).toBe(true);
    const viewerPoint = positions.get('sample-viewer')!;
    expect(
      width / 2
        + viewport.panX
        + (viewerPoint.x - SAMPLE_REVENUE_GRAPH_SURFACE_CENTER)
          * viewport.scale,
    ).toBeCloseTo(insets.left + (
      width - insets.left - insets.right
    ) / 2);
    expect(
      height / 2
        + viewport.panY
        + (viewerPoint.y - SAMPLE_REVENUE_GRAPH_SURFACE_CENTER)
          * viewport.scale,
    ).toBeCloseTo(insets.top + (
      height - insets.top - insets.bottom
    ) / 2);

    for (const node of model.nodes) {
      const point = positions.get(node.id)!;
      const radius = (getSampleRevenueGraphNodeRadius(node) + 54)
        * viewport.scale;
      const screenX = width / 2
        + viewport.panX
        + (point.x - SAMPLE_REVENUE_GRAPH_SURFACE_CENTER) * viewport.scale;
      const screenY = height / 2
        + viewport.panY
        + (point.y - SAMPLE_REVENUE_GRAPH_SURFACE_CENTER) * viewport.scale;
      expect(screenX - radius).toBeGreaterThanOrEqual(insets.left - 1e-6);
      expect(screenX + radius).toBeLessThanOrEqual(
        width - insets.right + 1e-6,
      );
      expect(screenY - radius).toBeGreaterThanOrEqual(insets.top - 1e-6);
      expect(screenY + radius).toBeLessThanOrEqual(
        height - insets.bottom + 1e-6,
      );
    }
  });

  it('fits finite nodes beyond the seed surface without a scale floor', () => {
    const positions = buildSampleRevenueGraphLayout(model.nodes, model.edges);
    const farNodeId = 'sample-a11';
    const farPoint = positions.get(farNodeId)!;
    const farPositions = new Map(positions);
    farPositions.set(farNodeId, {
      x: farPoint.x + 50_000,
      y: farPoint.y - 40_000,
    });
    const width = 800;
    const height = 360;
    const insets = { top: 70, right: 16, bottom: 18, left: 16 };
    const viewport = getSampleRevenueGraphFitViewport({
      nodes: model.nodes,
      positions: farPositions,
      width,
      height,
      insets,
    });

    expect(viewport.scale).toBeGreaterThan(0);
    expect(viewport.scale).toBeLessThan(SAMPLE_REVENUE_GRAPH_MIN_SCALE);
    const screenX = width / 2
      + viewport.panX
      + (farPositions.get(farNodeId)!.x
        - SAMPLE_REVENUE_GRAPH_SURFACE_CENTER) * viewport.scale;
    const screenY = height / 2
      + viewport.panY
      + (farPositions.get(farNodeId)!.y
        - SAMPLE_REVENUE_GRAPH_SURFACE_CENTER) * viewport.scale;
    expect(screenX).toBeGreaterThanOrEqual(insets.left);
    expect(screenX).toBeLessThanOrEqual(width - insets.right);
    expect(screenY).toBeGreaterThanOrEqual(insets.top);
    expect(screenY).toBeLessThanOrEqual(height - insets.bottom);
  });

  it('encodes viewer, eligible, and excluded nodes without sharing a color', () => {
    const viewer = model.nodes.find((node) => node.id === 'sample-viewer')!;
    const a1 = model.nodes.find((node) => node.id === 'sample-a1')!;
    const a11 = model.nodes.find((node) => node.id === 'sample-a11')!;

    expect(new Set([
      getSampleRevenueGraphNodeColor(viewer),
      getSampleRevenueGraphNodeColor(a1),
      getSampleRevenueGraphNodeColor(a11),
    ]).size).toBe(3);
    expect(getSampleRevenueGraphNodeRadius(viewer))
      .toBeGreaterThan(getSampleRevenueGraphNodeRadius(a11));
    expect(formatCompactSampleRevenueKrw(a1.expectedAllocationKrw))
      .toBe('120만원');
    expect(formatSampleRevenueNodeAmount(a1.expectedAllocationKrw))
      .toBe('120만');
    expect(formatSampleRevenueNodeAmount(950_000)).toBe('95만');
    expect(formatSampleRevenueNodeAmount(52_000)).toBe('5.2만');
  });
});
