import type { GraphEdge, GraphNode } from '../types/referral-graph';

export type ReferralGraphLinkRenderLayer = 'background' | 'foreground';

export type ReferralGraphLinkStyle = {
  alpha: number;
  layer: ReferralGraphLinkRenderLayer;
  width: number;
};

type ReferralGraphLinkStyleOptions = {
  isSelectionEdge?: boolean;
};

const QUIET_HUB_SPOKE_STYLE: ReferralGraphLinkStyle = {
  alpha: 0.3,
  layer: 'background',
  width: 0.95,
};

const BRANCH_LINK_STYLE: ReferralGraphLinkStyle = {
  alpha: 0.48,
  layer: 'foreground',
  width: 1.2,
};

const SELECTED_LINK_STYLE: ReferralGraphLinkStyle = {
  alpha: 0.86,
  layer: 'foreground',
  width: 1.7,
};

export function getReferralGraphLinkStyle(
  source: GraphNode,
  target: GraphNode,
  options: ReferralGraphLinkStyleOptions = {},
): ReferralGraphLinkStyle {
  if (options.isSelectionEdge) {
    return SELECTED_LINK_STYLE;
  }

  const sourceDegree = source.referralCount + source.inboundCount;
  const targetDegree = target.referralCount + target.inboundCount;
  const dominantDegree = Math.max(sourceDegree, targetDegree);
  if (dominantDegree >= 12) {
    return QUIET_HUB_SPOKE_STYLE;
  }

  return BRANCH_LINK_STYLE;
}

export function getReferralGraphLinkLayerRank(layer: ReferralGraphLinkRenderLayer) {
  return layer === 'background' ? 0 : 1;
}

export function sortReferralGraphLinksForRendering(edges: GraphEdge[], nodesById: Map<string, GraphNode>) {
  return [...edges].sort((left, right) => {
    const leftSource = nodesById.get(left.source);
    const leftTarget = nodesById.get(left.target);
    const rightSource = nodesById.get(right.source);
    const rightTarget = nodesById.get(right.target);
    const leftRank = leftSource && leftTarget
      ? getReferralGraphLinkLayerRank(getReferralGraphLinkStyle(leftSource, leftTarget).layer)
      : 1;
    const rightRank = rightSource && rightTarget
      ? getReferralGraphLinkLayerRank(getReferralGraphLinkStyle(rightSource, rightTarget).layer)
      : 1;

    return leftRank - rightRank || left.id.localeCompare(right.id);
  });
}
