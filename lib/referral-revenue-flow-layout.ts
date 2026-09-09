import { getReferralGraphNodeScreenRadius } from '@/lib/referral-graph-native';
import type { SampleRevenueEdgeFlow } from '@/lib/referral-revenue-flow';
import type { SampleRevenueGraphNode } from '@/types/referral-revenue-graph';
import type { ReferralGraphPoint } from '@/types/referral-graph';

export const REVENUE_FLOW_LABEL_WIDTH = 72;
export const REVENUE_FLOW_LABEL_HEIGHT = 22;
export const REVENUE_NODE_CAPTION_WIDTH = 88;
export const REVENUE_NODE_CAPTION_HEIGHT = 17;

const NODE_RING_GAP = 7;
const NODE_CAPTION_GAP = 5;
const COLLISION_GAP = 3;
const FLOW_LABEL_NORMAL_OFFSETS = [
  18,
  -18,
  30,
  -30,
  42,
  -42,
  54,
  -54,
  66,
  -66,
] as const;
const FLOW_LABEL_PROGRESS = [0.5, 0.42, 0.58, 0.34, 0.66] as const;

export type RevenueFlowScreenRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type RevenueFlowLabelLayout = {
  flowId: string;
  point: ReferralGraphPoint;
  screenRect: RevenueFlowScreenRect;
};

type NodeObstacleOptions = {
  nodes: readonly SampleRevenueGraphNode[];
  positions: ReadonlyMap<string, ReferralGraphPoint>;
  descendantCounts: ReadonlyMap<string, number>;
  graphScale: number;
  nodeVisualScale: number;
  labelVisualScale: number;
  focusedNodeIds?: ReadonlySet<string>;
};

type FlowLabelLayoutOptions = NodeObstacleOptions & {
  flows: readonly SampleRevenueEdgeFlow[];
  selectedEdgeIds?: ReadonlySet<string>;
};

const makeScreenRect = (
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): RevenueFlowScreenRect => ({
  left: centerX - width / 2,
  top: centerY - height / 2,
  right: centerX + width / 2,
  bottom: centerY + height / 2,
});

export const revenueFlowScreenRectsOverlap = (
  first: RevenueFlowScreenRect,
  second: RevenueFlowScreenRect,
  gap = 0,
) => !(
  first.right + gap <= second.left
  || second.right + gap <= first.left
  || first.bottom + gap <= second.top
  || second.bottom + gap <= first.top
);

export const revenueFlowScreenRectFitsViewport = (
  rect: RevenueFlowScreenRect,
  viewport: RevenueFlowScreenRect,
  inset = 0,
) => (
  rect.left >= viewport.left + inset
  && rect.top >= viewport.top + inset
  && rect.right <= viewport.right - inset
  && rect.bottom <= viewport.bottom - inset
);

const getScreenPoint = (point: ReferralGraphPoint, graphScale: number) => ({
  x: point.x * graphScale,
  y: point.y * graphScale,
});

const shouldRenderNodeCaption = (
  node: SampleRevenueGraphNode,
  focusedNodeIds?: ReadonlySet<string>,
) => (
  node.isViewer
  || !node.eligible
  || focusedNodeIds === undefined
  || focusedNodeIds.has(node.id)
);

export function getRevenueFlowNodeObstacleRects({
  nodes,
  positions,
  descendantCounts,
  graphScale,
  nodeVisualScale,
  labelVisualScale,
  focusedNodeIds,
}: NodeObstacleOptions): RevenueFlowScreenRect[] {
  const safeScale = Math.max(graphScale, 0.001);

  return nodes.flatMap((node) => {
    const point = positions.get(node.id);
    if (!point) return [];

    const screenPoint = getScreenPoint(point, safeScale);
    const nodeRadius = getReferralGraphNodeScreenRadius(
      descendantCounts.get(node.id) ?? 0,
    ) * nodeVisualScale;
    const markerRadius = nodeRadius + NODE_RING_GAP * nodeVisualScale;
    const obstacles = [makeScreenRect(
      screenPoint.x,
      screenPoint.y,
      markerRadius * 2,
      markerRadius * 2,
    )];

    if (shouldRenderNodeCaption(node, focusedNodeIds)) {
      const captionHeight = REVENUE_NODE_CAPTION_HEIGHT * labelVisualScale;
      const captionCenterY = screenPoint.y
        + nodeRadius
        + NODE_CAPTION_GAP
        + captionHeight / 2;
      obstacles.push(makeScreenRect(
        screenPoint.x,
        captionCenterY,
        REVENUE_NODE_CAPTION_WIDTH * labelVisualScale,
        captionHeight,
      ));
    }

    return obstacles;
  });
}

const getFlowPriority = (
  flow: SampleRevenueEdgeFlow,
  nodesById: ReadonlyMap<string, SampleRevenueGraphNode>,
  selectedEdgeIds?: ReadonlySet<string>,
) => {
  if (selectedEdgeIds?.has(flow.id)) return 0;
  if (nodesById.get(flow.source)?.isViewer) return 1;
  return 2;
};

export function buildRevenueFlowLabelLayouts({
  flows,
  nodes,
  positions,
  descendantCounts,
  graphScale,
  nodeVisualScale,
  labelVisualScale,
  focusedNodeIds,
  selectedEdgeIds,
}: FlowLabelLayoutOptions): RevenueFlowLabelLayout[] {
  const safeScale = Math.max(graphScale, 0.001);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const obstacles = getRevenueFlowNodeObstacleRects({
    nodes,
    positions,
    descendantCounts,
    graphScale: safeScale,
    nodeVisualScale,
    labelVisualScale,
    focusedNodeIds,
  });
  const placedRects: RevenueFlowScreenRect[] = [];
  const layouts: RevenueFlowLabelLayout[] = [];
  const labelWidth = REVENUE_FLOW_LABEL_WIDTH * labelVisualScale;
  const labelHeight = REVENUE_FLOW_LABEL_HEIGHT * labelVisualScale;
  const positiveFlows = flows
    .filter((flow) => flow.amountKrw > 0)
    .sort((first, second) => (
      getFlowPriority(first, nodesById, selectedEdgeIds)
        - getFlowPriority(second, nodesById, selectedEdgeIds)
      || second.amountKrw - first.amountKrw
      || first.id.localeCompare(second.id)
    ));

  for (const flow of positiveFlows) {
    const parent = positions.get(flow.source);
    const child = positions.get(flow.target);
    if (!parent || !child) continue;

    const dx = parent.x - child.x;
    const dy = parent.y - child.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const normalX = -dy / distance;
    const normalY = dx / distance;
    let selectedLayout: RevenueFlowLabelLayout | null = null;

    for (const progress of FLOW_LABEL_PROGRESS) {
      if (selectedLayout) break;
      const baseX = child.x + dx * progress;
      const baseY = child.y + dy * progress;

      for (const normalOffset of FLOW_LABEL_NORMAL_OFFSETS) {
        const point = {
          x: baseX + (normalX * normalOffset) / safeScale,
          y: baseY + (normalY * normalOffset) / safeScale,
        };
        const screenPoint = getScreenPoint(point, safeScale);
        const screenRect = makeScreenRect(
          screenPoint.x,
          screenPoint.y,
          labelWidth,
          labelHeight,
        );
        const collides = obstacles.some((obstacle) => (
          revenueFlowScreenRectsOverlap(screenRect, obstacle, COLLISION_GAP)
        )) || placedRects.some((placed) => (
          revenueFlowScreenRectsOverlap(screenRect, placed, COLLISION_GAP)
        ));

        if (!collides) {
          selectedLayout = { flowId: flow.id, point, screenRect };
          break;
        }
      }
    }

    if (selectedLayout) {
      layouts.push(selectedLayout);
      placedRects.push(selectedLayout.screenRect);
    }
  }

  return layouts;
}
