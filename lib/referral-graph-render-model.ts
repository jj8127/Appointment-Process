import { REFERRAL_GRAPH_SURFACE_CENTER, getReferralGraphNodeScreenRadius } from './referral-graph-native';
import { REFERRAL_GRAPH_HIT_SIZE, REFERRAL_GRAPH_LABEL_GAP, REFERRAL_GRAPH_VISUAL_MAX_SCALE, getReferralGraphLabelSize } from './referral-graph-readable';
import { doesReferralGraphSegmentIntersectRect, getReferralGraphViewportWorldRect, isReferralGraphPointInRect, type ReferralGraphCameraSnapshot } from './referral-graph-viewport';
import type { ReferralGraphEdge, ReferralGraphNode, ReferralGraphPoint } from '@/types/referral-graph';

export const REFERRAL_GRAPH_OVERSCAN = 192;

/** Include the whole label, selection ring, and touch target when its anchor is outside. */
export function getReferralGraphPrimitivePadding(nodes: ReferralGraphNode[], fontScale: number) {
  return nodes.reduce((padding, node) => {
    const label = getReferralGraphLabelSize(node.name, fontScale);
    const radius = (getReferralGraphNodeScreenRadius(node.totalDescendantCount) + 9) * REFERRAL_GRAPH_VISUAL_MAX_SCALE;
    return Math.max(padding, radius + REFERRAL_GRAPH_LABEL_GAP + Math.max(label.width, label.height) + 4);
  }, REFERRAL_GRAPH_HIT_SIZE / 2);
}

/** Data stays intact. Only mounted primitives are pruned, on discrete camera updates. */
export function buildReferralGraphRenderSet(options: {
  nodes: ReferralGraphNode[];
  edges: ReferralGraphEdge[];
  positions: Map<string, ReferralGraphPoint>;
  camera: ReferralGraphCameraSnapshot;
  primitivePadding: number;
  renderAll?: boolean;
}) {
  const { nodes, edges, positions, camera, primitivePadding, renderAll = false } = options;
  const bounds = getReferralGraphViewportWorldRect(camera, REFERRAL_GRAPH_OVERSCAN + primitivePadding);
  const positionedNodes = nodes.flatMap((node) => {
    const point = positions.get(node.id);
    return point && (renderAll || isReferralGraphPointInRect(point, bounds)) ? [{ node, point }] : [];
  });
  const path: string[] = [];
  let edgeCount = 0;
  for (const edge of edges) {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target || (!renderAll && !doesReferralGraphSegmentIntersectRect(source, target, bounds))) continue;
    edgeCount += 1;
    // Separate subpaths preserve independent round caps and do not fabricate links.
    path.push(`M${source.x - REFERRAL_GRAPH_SURFACE_CENTER} ${source.y - REFERRAL_GRAPH_SURFACE_CENTER}L${target.x - REFERRAL_GRAPH_SURFACE_CENTER} ${target.y - REFERRAL_GRAPH_SURFACE_CENTER}`);
  }
  return { positionedNodes, edgePath: path.join(''), edgeCount };
}
