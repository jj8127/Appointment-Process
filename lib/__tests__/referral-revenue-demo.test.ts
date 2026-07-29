import { SAMPLE_REFERRAL_REVENUE_NODES } from '@/data/referral-revenue-demo';
import {
  buildSampleRevenueGraphModel,
  calculateSampleRevenueAllocationKrw,
  deriveSampleRevenueDepths,
  filterSampleRevenueNodesByDepth,
  formatSampleRevenueKrw,
  getSampleRevenueGraphContextNodes,
  isSampleRevenueEligibleDepth,
  SAMPLE_REVENUE_MAX_DEPTH,
  SAMPLE_REVENUE_MIN_DEPTH,
  SAMPLE_REVENUE_RATE_BPS,
  sortSampleRevenueNodesByExpectedAmount,
} from '@/lib/referral-revenue-demo';
import type {
  SampleRevenueGraphNode,
  SampleRevenueRawNode,
} from '@/types/referral-revenue-graph';

const findNode = (
  nodes: readonly SampleRevenueGraphNode[],
  id: string,
): SampleRevenueGraphNode => {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) {
    throw new Error(`Missing test node: ${id}`);
  }
  return node;
};

const expectConnectedToSampleViewer = (
  nodes: readonly SampleRevenueGraphNode[],
): void => {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    let current = node;
    const visited = new Set<string>();

    while (!current.isViewer) {
      expect(visited.has(current.id)).toBe(false);
      visited.add(current.id);
      expect(current.parentId).not.toBeNull();

      const parent = current.parentId
        ? nodesById.get(current.parentId)
        : undefined;
      expect(parent).toBeDefined();
      current = parent as SampleRevenueGraphNode;
    }

    expect(current.id).toBe('sample-viewer');
  }
};

describe('sample referral revenue demo model', () => {
  it('derives every depth from parentId, including the A chain boundary', () => {
    const depths = deriveSampleRevenueDepths(SAMPLE_REFERRAL_REVENUE_NODES);

    expect(depths.get('sample-viewer')).toBe(0);
    expect(depths.get('sample-a1')).toBe(1);
    expect(depths.get('sample-a10')).toBe(10);
    expect(depths.get('sample-a11')).toBe(11);
    expect(depths.get('sample-b3')).toBe(3);
    expect(depths.get('sample-c2')).toBe(2);
  });

  it('accepts only integer depths one through ten', () => {
    expect(SAMPLE_REVENUE_MIN_DEPTH).toBe(1);
    expect(SAMPLE_REVENUE_MAX_DEPTH).toBe(10);
    expect(isSampleRevenueEligibleDepth(0)).toBe(false);
    expect(isSampleRevenueEligibleDepth(1)).toBe(true);
    expect(isSampleRevenueEligibleDepth(10)).toBe(true);
    expect(isSampleRevenueEligibleDepth(11)).toBe(false);
    expect(isSampleRevenueEligibleDepth(25)).toBe(false);
    expect(isSampleRevenueEligibleDepth(1.5)).toBe(false);
  });

  it('applies the ten-percent sample rate only within the eligible depth range', () => {
    expect(SAMPLE_REVENUE_RATE_BPS).toBe(1_000);
    expect(calculateSampleRevenueAllocationKrw(2_400_000, 10)).toBe(240_000);
    expect(calculateSampleRevenueAllocationKrw(9_900_000, 11)).toBe(0);
    expect(calculateSampleRevenueAllocationKrw(12_000_000, 0)).toBe(0);
  });

  it('builds the fixed summary while excluding the viewer and A11', () => {
    const model = buildSampleRevenueGraphModel(SAMPLE_REFERRAL_REVENUE_NODES);
    const viewer = findNode(model.nodes, 'sample-viewer');
    const a10 = findNode(model.nodes, 'sample-a10');
    const a11 = findNode(model.nodes, 'sample-a11');

    expect(viewer).toMatchObject({
      depth: 0,
      isViewer: true,
      eligible: false,
      expectedAllocationKrw: 0,
      pathNames: ['나 (샘플)'],
    });
    expect(a10).toMatchObject({
      depth: 10,
      eligible: true,
      expectedAllocationKrw: 240_000,
    });
    expect(a11).toMatchObject({
      depth: 11,
      eligible: false,
      expectedAllocationKrw: 0,
    });
    expect(model.summary).toEqual({
      eligibleContributorCount: 15,
      eligibleSalesKrw: 102_400_000,
      expectedAllocationKrw: 10_240_000,
      excludedContributorCount: 1,
    });
    expect(model.edges).toHaveLength(16);
  });

  it('ignores an untrusted input depth and re-derives it from parentId', () => {
    const nodesWithForgedDepth = SAMPLE_REFERRAL_REVENUE_NODES.map((node) => ({
      ...node,
      depth: node.id === 'sample-a11' ? 1 : 99,
    }));

    const model = buildSampleRevenueGraphModel(nodesWithForgedDepth);

    expect(findNode(model.nodes, 'sample-a11')).toMatchObject({
      depth: 11,
      eligible: false,
      expectedAllocationKrw: 0,
    });
  });

  it('throws for duplicate ids, orphan parents, cycles, and multiple roots', () => {
    expect(() => deriveSampleRevenueDepths([
      ...SAMPLE_REFERRAL_REVENUE_NODES,
      SAMPLE_REFERRAL_REVENUE_NODES[0],
    ])).toThrow(/duplicate/i);

    expect(() => deriveSampleRevenueDepths([
      { id: 'root', parentId: null, name: 'root', affiliation: '', salesKrw: 0 },
      { id: 'orphan', parentId: 'missing', name: 'orphan', affiliation: '', salesKrw: 1 },
    ])).toThrow(/orphan/i);

    expect(() => deriveSampleRevenueDepths([
      { id: 'root', parentId: null, name: 'root', affiliation: '', salesKrw: 0 },
      { id: 'cycle-a', parentId: 'cycle-b', name: 'a', affiliation: '', salesKrw: 1 },
      { id: 'cycle-b', parentId: 'cycle-a', name: 'b', affiliation: '', salesKrw: 1 },
    ])).toThrow(/cycle/i);

    expect(() => deriveSampleRevenueDepths([
      { id: 'root-a', parentId: null, name: 'a', affiliation: '', salesKrw: 0 },
      { id: 'root-b', parentId: null, name: 'b', affiliation: '', salesKrw: 0 },
    ])).toThrow(/exactly one root/i);
  });

  it('filters inclusive depth ranges without mutating source nodes', () => {
    const model = buildSampleRevenueGraphModel(SAMPLE_REFERRAL_REVENUE_NODES);
    const filtered = filterSampleRevenueNodesByDepth(
      model.nodes,
      '7-10',
    );

    expect(filtered.map((node) => node.id)).toEqual([
      'sample-viewer',
      'sample-a7',
      'sample-a8',
      'sample-a9',
      'sample-a10',
    ]);
    expect(filterSampleRevenueNodesByDepth(model.nodes, 'all')).not.toBe(model.nodes);
    expect(
      filterSampleRevenueNodesByDepth(model.nodes, '1-3')
        .filter((node) => !node.isViewer)
        .every((node) => node.depth >= 1 && node.depth <= 3),
    ).toBe(true);
    expect(
      filterSampleRevenueNodesByDepth(model.nodes, '4-6')
        .filter((node) => !node.isViewer)
        .every((node) => node.depth >= 4 && node.depth <= 6),
    ).toBe(true);
    expect(model.nodes).toHaveLength(17);
  });

  it('preserves source order and viewer-connected ancestry for graph filters', () => {
    const model = buildSampleRevenueGraphModel(SAMPLE_REFERRAL_REVENUE_NODES);
    const expectedIdsByFilter = {
      all: model.nodes.map((node) => node.id),
      '1-3': [
        'sample-viewer',
        'sample-a1',
        'sample-a2',
        'sample-a3',
        'sample-b1',
        'sample-b2',
        'sample-b3',
        'sample-c1',
        'sample-c2',
      ],
      '4-6': [
        'sample-viewer',
        'sample-a1',
        'sample-a2',
        'sample-a3',
        'sample-a4',
        'sample-a5',
        'sample-a6',
      ],
      '7-10': [
        'sample-viewer',
        'sample-a1',
        'sample-a2',
        'sample-a3',
        'sample-a4',
        'sample-a5',
        'sample-a6',
        'sample-a7',
        'sample-a8',
        'sample-a9',
        'sample-a10',
      ],
    } as const;

    for (const filter of ['all', '1-3', '4-6', '7-10'] as const) {
      const contextNodes = getSampleRevenueGraphContextNodes(
        model.nodes,
        filter,
      );

      expect(contextNodes.map((node) => node.id)).toEqual(
        expectedIdsByFilter[filter],
      );
      expectConnectedToSampleViewer(contextNodes);
    }

    expect(
      getSampleRevenueGraphContextNodes(model.nodes, 'all'),
    ).not.toBe(model.nodes);
  });

  it('sorts expected amounts descending and breaks ties by stable id order', () => {
    const baseNode: Omit<SampleRevenueGraphNode, 'id' | 'expectedAllocationKrw'> = {
      parentId: 'sample-viewer',
      name: 'sample',
      affiliation: '',
      salesKrw: 1_000,
      depth: 1,
      pathNames: ['나 (샘플)', 'sample'],
      isViewer: false,
      eligible: true,
    };
    const input: SampleRevenueGraphNode[] = [
      { ...baseNode, id: 'sample-z', expectedAllocationKrw: 100 },
      { ...baseNode, id: 'sample-b', expectedAllocationKrw: 300 },
      { ...baseNode, id: 'sample-a', expectedAllocationKrw: 300 },
      { ...baseNode, id: 'sample-y', expectedAllocationKrw: 0 },
      {
        ...baseNode,
        id: 'sample-x',
        eligible: false,
        expectedAllocationKrw: 0,
      },
    ];

    expect(
      sortSampleRevenueNodesByExpectedAmount(input).map((node) => node.id),
    ).toEqual(['sample-a', 'sample-b', 'sample-z', 'sample-y', 'sample-x']);
    expect(input.map((node) => node.id)).toEqual([
      'sample-z',
      'sample-b',
      'sample-a',
      'sample-y',
      'sample-x',
    ]);
  });

  it('formats sample KRW values consistently', () => {
    expect(formatSampleRevenueKrw(102_400_000)).toBe('102,400,000원');
    expect(formatSampleRevenueKrw(10_240_000)).toBe('10,240,000원');
    expect(formatSampleRevenueKrw(0)).toBe('0원');
  });

  it('keeps the raw node contract free of a depth field', () => {
    const rawNode: SampleRevenueRawNode = SAMPLE_REFERRAL_REVENUE_NODES[0];

    expect(Object.keys(rawNode).sort()).toEqual([
      'affiliation',
      'id',
      'name',
      'parentId',
      'salesKrw',
    ]);
  });
});
