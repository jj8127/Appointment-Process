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

const ROOT_SPOKE_CHILD_THRESHOLD = 12;

export function isReferralGraphRootSpoke(source: GraphNode, target: GraphNode) {
  return (
    source.inboundCount === 0
    && source.referralCount >= ROOT_SPOKE_CHILD_THRESHOLD
    && target.inboundCount >= 1
  );
}

export function getReferralGraphLinkStyle(
  source: GraphNode,
  target: GraphNode,
  options: ReferralGraphLinkStyleOptions = {},
): ReferralGraphLinkStyle {
  if (options.isSelectionEdge) {
    return {
      alpha: 0.86,
      layer: 'foreground',
      width: 1.82,
    };
  }

  if (isReferralGraphRootSpoke(source, target)) {
    return {
      alpha: 0.2,
      layer: 'background',
      width: 0.62,
    };
  }

  return {
    alpha: 0.52,
    layer: 'foreground',
    width: 1.08,
  };
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
