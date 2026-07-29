import {
  buildReferralGraphLayout,
  filterReferralGraphNodes,
  getReferralGraphFitViewport,
  getReferralGraphNeighborhood,
  getReferralGraphNodeColor,
  getReferralGraphNodeRadius,
  normalizeReferralGraph,
  REFERRAL_GRAPH_MAX_SCALE,
  REFERRAL_GRAPH_SURFACE_CENTER,
  REFERRAL_GRAPH_SURFACE_SIZE,
} from '@/lib/referral-graph-native';
import type { ReferralGraphEdge, ReferralGraphNode } from '@/types/referral-graph';

const node = (
  id: string,
  overrides: Partial<ReferralGraphNode> = {},
): ReferralGraphNode => ({
  id,
  name: id,
  affiliation: '',
  activeCode: null,
  nodeStatus: 'missing_code',
  signupCompleted: false,
  allCommissionsCompleted: false,
  directInviteeCount: 0,
  totalDescendantCount: 0,
  isViewer: false,
  ...overrides,
});

const edge = (source: string, target: string): ReferralGraphEdge => ({
  id: `${source}__${target}`,
  source,
  target,
});

describe('native referral graph helpers', () => {
  it('uses viewer, commission, signup, preregistration color priority', () => {
    expect(getReferralGraphNodeColor(node('viewer', {
      isViewer: true,
      allCommissionsCompleted: true,
      signupCompleted: true,
    }))).toBe('#facc15');
    expect(getReferralGraphNodeColor(node('commissioned', {
      allCommissionsCompleted: true,
      signupCompleted: true,
    }))).toBe('#0f9f6e');
    expect(getReferralGraphNodeColor(node('registered', {
      signupCompleted: true,
    }))).toBe('#ea580c');
    expect(getReferralGraphNodeColor(node('preregistered'))).toBe('#94a3b8');
  });

  it('grows node radius by total descendants with a bounded cap', () => {
    expect(getReferralGraphNodeRadius(0)).toBeCloseTo(5.75);
    expect(getReferralGraphNodeRadius(10)).toBeGreaterThan(getReferralGraphNodeRadius(1));
    expect(getReferralGraphNodeRadius(100000)).toBeCloseTo(17.5);
  });

  it('deduplicates nodes and canonical edges while dropping unsafe edges', () => {
    const graph = normalizeReferralGraph(
      [node('root', { name: '  ' }), node('child'), node('child')],
      [
        edge('root', 'child'),
        { ...edge('root', 'child'), id: 'duplicate-id' },
        edge('root', 'missing'),
        edge('root', 'root'),
      ],
    );

    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.find((item) => item.id === 'root')?.name).toBe('이름 없음');
    expect(graph.edges).toEqual([edge('root', 'child')]);
  });

  it('builds a deterministic finite layout and survives a cycle', () => {
    const nodes = [
      node('root', { isViewer: true, totalDescendantCount: 3 }),
      node('a'),
      node('b'),
      node('c'),
    ];
    const edges = [edge('root', 'a'), edge('root', 'b'), edge('a', 'c'), edge('c', 'root')];
    const first = buildReferralGraphLayout(nodes, edges);
    const second = buildReferralGraphLayout(nodes.slice().reverse(), edges.slice().reverse());

    expect(first.get('root')).toEqual({
      x: REFERRAL_GRAPH_SURFACE_CENTER,
      y: REFERRAL_GRAPH_SURFACE_CENTER,
    });
    expect(Array.from(first.entries())).toEqual(Array.from(second.entries()));
    for (const point of first.values()) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
  });

  it('compresses deep hierarchies inside the fixed native surface', () => {
    const deepNodes = Array.from({ length: 21 }, (_, index) => (
      node(`depth-${index}`, { isViewer: index === 0 })
    ));
    const deepEdges = Array.from(
      { length: 20 },
      (_, index) => edge(`depth-${index}`, `depth-${index + 1}`),
    );
    const positions = buildReferralGraphLayout(deepNodes, deepEdges);

    expect(positions.size).toBe(21);
    for (const point of positions.values()) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(REFERRAL_GRAPH_SURFACE_SIZE);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(REFERRAL_GRAPH_SURFACE_SIZE);
    }
  });

  it('keeps a 300-node star graph separable at maximum zoom', () => {
    const childCount = 299;
    const nodes = [
      node('root', { isViewer: true, totalDescendantCount: childCount }),
      ...Array.from({ length: childCount }, (_, index) => node(`child-${index}`)),
    ];
    const edges = Array.from(
      { length: childCount },
      (_, index) => edge('root', `child-${index}`),
    );
    const positions = buildReferralGraphLayout(nodes, edges);
    const childPositions = nodes
      .slice(1)
      .map((item) => positions.get(item.id))
      .filter((point): point is { x: number; y: number } => Boolean(point));

    let minDistance = Number.POSITIVE_INFINITY;
    for (let left = 0; left < childPositions.length; left += 1) {
      for (let right = left + 1; right < childPositions.length; right += 1) {
        const dx = childPositions[left].x - childPositions[right].x;
        const dy = childPositions[left].y - childPositions[right].y;
        minDistance = Math.min(minDistance, Math.hypot(dx, dy));
      }
    }

    expect(positions.size).toBe(300);
    expect(minDistance * REFERRAL_GRAPH_MAX_SCALE).toBeGreaterThanOrEqual(48);
    for (const point of positions.values()) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(REFERRAL_GRAPH_SURFACE_SIZE);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(REFERRAL_GRAPH_SURFACE_SIZE);
    }
  });

  it('reserves selectable spacing for small siblings beside a heavy branch', () => {
    const heavyLeafCount = 296;
    const nodes = [
      node('root', { isViewer: true, totalDescendantCount: heavyLeafCount + 3 }),
      node('heavy', { totalDescendantCount: heavyLeafCount }),
      node('small-a'),
      node('small-b'),
      ...Array.from({ length: heavyLeafCount }, (_, index) => node(`heavy-leaf-${index}`)),
    ];
    const edges = [
      edge('root', 'heavy'),
      edge('root', 'small-a'),
      edge('root', 'small-b'),
      ...Array.from(
        { length: heavyLeafCount },
        (_, index) => edge('heavy', `heavy-leaf-${index}`),
      ),
    ];
    const positions = buildReferralGraphLayout(nodes, edges);
    const smallA = positions.get('small-a');
    const smallB = positions.get('small-b');

    expect(positions.size).toBe(300);
    expect(smallA).toBeDefined();
    expect(smallB).toBeDefined();
    expect(
      Math.hypot(
        (smallA?.x ?? 0) - (smallB?.x ?? 0),
        (smallA?.y ?? 0) - (smallB?.y ?? 0),
      ) * REFERRAL_GRAPH_MAX_SCALE,
    ).toBeGreaterThanOrEqual(48);
  });

  it('fits visible graph bounds into the viewport', () => {
    const nodes = [node('root', { isViewer: true }), node('child')];
    const positions = new Map([
      ['root', { x: 700, y: 800 }],
      ['child', { x: 1100, y: 800 }],
    ]);
    const viewport = getReferralGraphFitViewport({
      nodes,
      positions,
      width: 360,
      height: 520,
    });

    expect(viewport.scale).toBeGreaterThanOrEqual(0.25);
    expect(viewport.scale).toBeLessThanOrEqual(6);
    expect(Number.isFinite(viewport.panX)).toBe(true);
    expect(Number.isFinite(viewport.panY)).toBe(true);
  });

  it('builds hop focus and filters by semantic state and search text', () => {
    const nodes = [
      node('root', { isViewer: true, name: '현재 사용자' }),
      node('a', { name: '가람', signupCompleted: true }),
      node('b', { name: '한화', allCommissionsCompleted: true, signupCompleted: true }),
      node('c', { name: '외부' }),
    ];
    const edges = [edge('root', 'a'), edge('a', 'b'), edge('b', 'c')];
    const neighborhood = getReferralGraphNeighborhood('root', edges, 2);

    expect(Array.from(neighborhood ?? []).sort()).toEqual(['a', 'b', 'root']);
    expect(filterReferralGraphNodes({
      nodes,
      searchTerm: '한',
      statusFilter: 'commissioned',
      neighborhood,
    }).map((item) => item.id)).toEqual(['b']);
  });
});
