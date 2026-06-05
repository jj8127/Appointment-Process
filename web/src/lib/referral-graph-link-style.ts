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

const UNIFORM_LINK_STYLE: ReferralGraphLinkStyle = {
  alpha: 0.64,
  layer: 'foreground',
  width: 1.2,
};

export function getReferralGraphLinkStyle(
  source: GraphNode,
  target: GraphNode,
  options: ReferralGraphLinkStyleOptions = {},
): ReferralGraphLinkStyle {
  void source;
  void target;
  void options;
  return UNIFORM_LINK_STYLE;
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
