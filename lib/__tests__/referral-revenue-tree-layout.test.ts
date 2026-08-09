import { REFERRAL_REVENUE_DEMO_RAW_NODES } from '@/data/referral-revenue-demo';
import { buildSampleRevenueGraphModel } from '@/lib/referral-revenue-demo';
import {
  getSampleRevenueTreeBranch,
  getSampleRevenueTreeCanvasHeight,
  getSampleRevenueTreeConnector,
  getSampleRevenueTreeNodePosition,
  SAMPLE_REVENUE_TREE_CANVAS_WIDTH,
  SAMPLE_REVENUE_TREE_NODE_HEIGHT,
  SAMPLE_REVENUE_TREE_NODE_WIDTH,
  SAMPLE_REVENUE_TREE_ROW_HEIGHT,
  SAMPLE_REVENUE_TREE_TOP,
} from '@/lib/referral-revenue-tree-layout';

const model = buildSampleRevenueGraphModel(REFERRAL_REVENUE_DEMO_RAW_NODES);
const node = (id: string) => model.nodes.find((item) => item.id === id)!;

describe('referral revenue tree layout', () => {
  it('restores the fixed viewer/A/B/C columns from the initial card tree', () => {
    expect(SAMPLE_REVENUE_TREE_CANVAS_WIDTH).toBe(440);
    expect(SAMPLE_REVENUE_TREE_NODE_WIDTH).toBe(118);
    expect(SAMPLE_REVENUE_TREE_NODE_HEIGHT).toBe(66);
    expect(SAMPLE_REVENUE_TREE_ROW_HEIGHT).toBe(86);
    expect(SAMPLE_REVENUE_TREE_TOP).toBe(24);

    expect(getSampleRevenueTreeBranch(node('sample-viewer'))).toBe('viewer');
    expect(getSampleRevenueTreeBranch(node('sample-a1'))).toBe('a');
    expect(getSampleRevenueTreeBranch(node('sample-b1'))).toBe('b');
    expect(getSampleRevenueTreeBranch(node('sample-c1'))).toBe('c');

    expect(getSampleRevenueTreeNodePosition(node('sample-viewer'))).toEqual({
      x: 161,
      y: 24,
    });
    expect(getSampleRevenueTreeNodePosition(node('sample-a1'))).toEqual({
      x: 24,
      y: 110,
    });
    expect(getSampleRevenueTreeNodePosition(node('sample-b1'))).toEqual({
      x: 161,
      y: 110,
    });
    expect(getSampleRevenueTreeNodePosition(node('sample-c1'))).toEqual({
      x: 298,
      y: 110,
    });
  });

  it('keeps the long A chain and canvas height deterministic', () => {
    expect(getSampleRevenueTreeNodePosition(node('sample-a11'))).toEqual({
      x: 24,
      y: 970,
    });
    expect(getSampleRevenueTreeCanvasHeight(model.nodes)).toBe(1080);
  });

  it('connects each parent card bottom-center to its child top-center', () => {
    expect(getSampleRevenueTreeConnector(
      node('sample-viewer'),
      node('sample-a1'),
    )).toEqual({
      x1: 220,
      y1: 90,
      x2: 83,
      y2: 110,
    });
    expect(getSampleRevenueTreeConnector(
      node('sample-a10'),
      node('sample-a11'),
    )).toEqual({
      x1: 83,
      y1: 950,
      x2: 83,
      y2: 970,
    });
  });
});
