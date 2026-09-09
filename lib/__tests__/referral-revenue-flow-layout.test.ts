import { REFERRAL_REVENUE_DEMO_RAW_NODES } from '@/data/referral-revenue-demo';
import {
  buildReferralGraphLayout,
} from '@/lib/referral-graph-native';
import { buildSampleRevenueGraphModel } from '@/lib/referral-revenue-demo';
import {
  buildSampleRevenueEdgeFlows,
  getSampleRevenueDescendantCounts,
} from '@/lib/referral-revenue-flow';
import {
  buildRevenueFlowLabelLayouts,
  getRevenueFlowNodeObstacleRects,
  revenueFlowScreenRectFitsViewport,
  revenueFlowScreenRectsOverlap,
} from '@/lib/referral-revenue-flow-layout';
import type { ReferralGraphNode } from '@/types/referral-graph';

const model = buildSampleRevenueGraphModel(REFERRAL_REVENUE_DEMO_RAW_NODES);
const descendantCounts = getSampleRevenueDescendantCounts(model.nodes);
const layoutNodes: ReferralGraphNode[] = model.nodes.map((node) => ({
  id: node.id,
  name: node.name,
  affiliation: node.affiliation,
  activeCode: null,
  nodeStatus: node.eligible ? 'has_active_code' : 'missing_code',
  signupCompleted: node.eligible,
  allCommissionsCompleted: false,
  directInviteeCount: 0,
  totalDescendantCount: descendantCounts.get(node.id) ?? 0,
  isViewer: node.isViewer,
}));
const positions = buildReferralGraphLayout(layoutNodes, model.edges);
const flows = buildSampleRevenueEdgeFlows(model.nodes, model.edges);

const getNodeVisualScale = (scale: number) => Math.min(Math.max(scale, 0.25), 1.4);
const getLabelVisualScale = (scale: number) => Math.min(Math.max(scale, 0.42), 1);

const expectNoOverlap = (scale: number) => {
  const nodeVisualScale = getNodeVisualScale(scale);
  const labelVisualScale = getLabelVisualScale(scale);
  const layouts = buildRevenueFlowLabelLayouts({
    flows,
    nodes: model.nodes,
    positions,
    descendantCounts,
    graphScale: scale,
    nodeVisualScale,
    labelVisualScale,
  });
  const obstacles = getRevenueFlowNodeObstacleRects({
    nodes: model.nodes,
    positions,
    descendantCounts,
    graphScale: scale,
    nodeVisualScale,
    labelVisualScale,
  });

  for (const layout of layouts) {
    for (const obstacle of obstacles) {
      expect(revenueFlowScreenRectsOverlap(layout.screenRect, obstacle, 2)).toBe(false);
    }
  }

  for (let index = 0; index < layouts.length; index += 1) {
    for (let nextIndex = index + 1; nextIndex < layouts.length; nextIndex += 1) {
      expect(revenueFlowScreenRectsOverlap(
        layouts[index].screenRect,
        layouts[nextIndex].screenRect,
        2,
      )).toBe(false);
    }
  }

  return layouts;
};

describe('referral allowance flow label layout', () => {
  it('rejects labels that would be clipped by the graph viewport', () => {
    const viewport = { left: 0, top: 0, right: 400, bottom: 600 };

    expect(revenueFlowScreenRectFitsViewport(
      { left: 8, top: 8, right: 80, bottom: 30 },
      viewport,
      6,
    )).toBe(true);
    expect(revenueFlowScreenRectFitsViewport(
      { left: -2, top: 8, right: 70, bottom: 30 },
      viewport,
      6,
    )).toBe(false);
    expect(revenueFlowScreenRectFitsViewport(
      { left: 340, top: 580, right: 412, bottom: 602 },
      viewport,
      6,
    )).toBe(false);
  });

  it.each([0.42, 0.58, 0.78, 1, 1.36, 1.4])(
    'keeps every visible label collision-free at %p scale',
    (scale) => {
      expectNoOverlap(scale);
    },
  );

  it('keeps every viewer-adjacent branch total at the reported 136% scale', () => {
    const layouts = expectNoOverlap(1.36);
    const visibleIds = new Set(layouts.map((layout) => layout.flowId));

    expect(layouts.length).toBeGreaterThanOrEqual(12);
    for (const branchEdgeId of [
      'sample-viewer__sample-a1',
      'sample-viewer__sample-b1',
      'sample-viewer__sample-c1',
    ]) {
      expect(visibleIds.has(branchEdgeId)).toBe(true);
    }
  });

  it('shows a selected dense branch before optional labels at 136% scale', () => {
    const selectedEdgeIds = new Set([
      'sample-viewer__sample-b1',
      'sample-b1__sample-b2',
      'sample-b2__sample-b3',
    ]);
    const layouts = buildRevenueFlowLabelLayouts({
      flows,
      nodes: model.nodes,
      positions,
      descendantCounts,
      graphScale: 1.36,
      nodeVisualScale: getNodeVisualScale(1.36),
      labelVisualScale: getLabelVisualScale(1.36),
      selectedEdgeIds,
    });
    const visibleIds = new Set(layouts.map((layout) => layout.flowId));

    for (const selectedEdgeId of selectedEdgeIds) {
      expect(visibleIds.has(selectedEdgeId)).toBe(true);
    }
  });

  it('prioritizes selected path labels deterministically when space is tight', () => {
    const selectedEdgeIds = new Set([
      'sample-viewer__sample-a1',
      'sample-a1__sample-a2',
      'sample-a2__sample-a3',
    ]);
    const options = {
      flows,
      nodes: model.nodes,
      positions,
      descendantCounts,
      graphScale: 0.58,
      nodeVisualScale: getNodeVisualScale(0.58),
      labelVisualScale: getLabelVisualScale(0.58),
      selectedEdgeIds,
    };
    const first = buildRevenueFlowLabelLayouts(options);
    const second = buildRevenueFlowLabelLayouts(options);

    expect(second).toEqual(first);
    expect(first.slice(0, selectedEdgeIds.size).map((layout) => layout.flowId)).toEqual([
      'sample-viewer__sample-a1',
      'sample-a1__sample-a2',
      'sample-a2__sample-a3',
    ]);
  });
});
