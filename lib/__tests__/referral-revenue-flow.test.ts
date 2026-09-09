import { REFERRAL_REVENUE_DEMO_RAW_NODES } from '@/data/referral-revenue-demo';
import { buildSampleRevenueGraphModel } from '@/lib/referral-revenue-demo';
import {
  buildSampleRevenueEdgeFlows,
  formatSampleRevenueFlowKrw,
  getSampleRevenueDescendantCounts,
} from '@/lib/referral-revenue-flow';

const model = buildSampleRevenueGraphModel(REFERRAL_REVENUE_DEMO_RAW_NODES);

const getFlow = (source: string, target: string) => {
  const flow = buildSampleRevenueEdgeFlows(model.nodes, model.edges)
    .find((candidate) => (
      candidate.source === source && candidate.target === target
    ));
  if (!flow) throw new Error(`Missing test flow ${source} -> ${target}`);
  return flow;
};

describe('sample referral revenue relationship flows', () => {
  it('aggregates every eligible downstream amount toward the viewer', () => {
    const branchA = getFlow('sample-viewer', 'sample-a1');
    const branchB = getFlow('sample-viewer', 'sample-b1');

    expect(branchA).toMatchObject({
      amountKrw: 6_410_000,
      contributorCount: 10,
    });
    expect(branchB).toMatchObject({
      amountKrw: 2_290_000,
      contributorCount: 3,
    });
  });

  it('keeps each deeper edge limited to contributors below that relationship', () => {
    expect(getFlow('sample-a8', 'sample-a9')).toMatchObject({
      amountKrw: 550_000,
      contributorCount: 2,
    });
    expect(getFlow('sample-a9', 'sample-a10')).toMatchObject({
      amountKrw: 240_000,
      contributorCount: 1,
    });
  });

  it('shows the excluded eleventh level as a relationship with no money flow', () => {
    expect(getFlow('sample-a10', 'sample-a11')).toMatchObject({
      amountKrw: 0,
      contributorCount: 0,
    });
  });

  it('aggregates only the selected depth contributors while retaining ancestry', () => {
    const contributorNodeIds = new Set([
      'sample-a4',
      'sample-a5',
      'sample-a6',
    ]);
    const flows = buildSampleRevenueEdgeFlows(model.nodes, model.edges, {
      contributorNodeIds,
    });
    const viewerEdge = flows.find(
      (flow) => flow.source === 'sample-viewer' && flow.target === 'sample-a1',
    );
    const belowSelection = flows.find(
      (flow) => flow.source === 'sample-a6' && flow.target === 'sample-a7',
    );

    expect(viewerEdge).toMatchObject({
      amountKrw: 2_030_000,
      contributorCount: 3,
    });
    expect(belowSelection).toMatchObject({
      amountKrw: 0,
      contributorCount: 0,
    });
  });

  it('derives visible descendant counts for relationship-style node sizing', () => {
    const counts = getSampleRevenueDescendantCounts(model.nodes);

    expect(counts.get('sample-viewer')).toBe(16);
    expect(counts.get('sample-a1')).toBe(10);
    expect(counts.get('sample-a11')).toBe(0);
  });

  it('formats compact Korean won labels without hiding meaningful precision', () => {
    expect(formatSampleRevenueFlowKrw(10_240_000)).toBe('1,024만');
    expect(formatSampleRevenueFlowKrw(950_000)).toBe('95만');
    expect(formatSampleRevenueFlowKrw(52_000)).toBe('5.2만');
    expect(formatSampleRevenueFlowKrw(0)).toBe('0원');
  });
});
