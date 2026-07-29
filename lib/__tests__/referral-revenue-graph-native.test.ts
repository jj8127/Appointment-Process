import { REFERRAL_REVENUE_DEMO_RAW_NODES } from '@/data/referral-revenue-demo';
import {
  buildSampleRevenueGraphLayout,
  formatCompactSampleRevenueKrw,
  formatSampleRevenueNodeAmount,
  getSampleRevenueGraphFitViewport,
  getSampleRevenueGraphNodeColor,
  getSampleRevenueGraphNodeRadius,
  SAMPLE_REVENUE_ADMIN_WEB_PHYSICS,
  SAMPLE_REVENUE_GRAPH_SURFACE_SIZE,
  stepSampleRevenueInteractivePhysics,
} from '@/lib/referral-revenue-graph-native';
import { buildSampleRevenueGraphModel } from '@/lib/referral-revenue-demo';

const model = buildSampleRevenueGraphModel(REFERRAL_REVENUE_DEMO_RAW_NODES);

describe('sample revenue native node-edge graph', () => {
  it('places every node deterministically around the viewer', () => {
    const first = buildSampleRevenueGraphLayout(model.nodes, model.edges);
    const second = buildSampleRevenueGraphLayout(model.nodes, model.edges);

    expect(first.size).toBe(model.nodes.length);
    expect(Array.from(first.entries())).toEqual(Array.from(second.entries()));
    expect(first.get('sample-viewer')).toBeDefined();

    for (const point of first.values()) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(SAMPLE_REVENUE_GRAPH_SURFACE_SIZE);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(SAMPLE_REVENUE_GRAPH_SURFACE_SIZE);
    }
  });

  it('uses the administrator web balanced force constants', () => {
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
  });

  it('settles every pair without node collision overlap', () => {
    const positions = buildSampleRevenueGraphLayout(model.nodes, model.edges);
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
        )).toBeGreaterThanOrEqual(84);
      }
    }
  });

  it('lets a dragged node push and pull its neighbors with live physics', () => {
    const positions = buildSampleRevenueGraphLayout(model.nodes, model.edges);
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
    const positions = buildSampleRevenueGraphLayout(model.nodes, model.edges);
    const firstLevelPoints = ['sample-a1', 'sample-b1', 'sample-c1']
      .map((id) => positions.get(id));

    expect(new Set(firstLevelPoints.map((point) => (
      point ? `${Math.round(point.x)}:${Math.round(point.y)}` : 'missing'
    ))).size).toBe(3);
  });

  it('builds a bounded fit viewport for a mobile canvas', () => {
    const positions = buildSampleRevenueGraphLayout(model.nodes, model.edges);
    const viewport = getSampleRevenueGraphFitViewport({
      nodes: model.nodes,
      positions,
      width: 360,
      height: 460,
    });

    expect(viewport.scale).toBeGreaterThan(0);
    expect(viewport.scale).toBeLessThanOrEqual(1);
    expect(Number.isFinite(viewport.panX)).toBe(true);
    expect(Number.isFinite(viewport.panY)).toBe(true);
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
