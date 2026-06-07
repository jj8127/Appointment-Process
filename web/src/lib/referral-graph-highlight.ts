import type { GraphNode, GraphNodeHighlightType } from '@/types/referral-graph';

function normalizeName(value?: string | null) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function resolveReferralGraphHighlightType(input: {
  name?: string | null;
  isManagerReferralShadow?: boolean | null;
  managerNames?: Set<string>;
}): GraphNodeHighlightType | null {
  const normalizedName = normalizeName(input.name);
  if (!normalizedName) {
    return null;
  }

  if (input.isManagerReferralShadow === true) {
    return 'manager';
  }

  if (input.managerNames?.has(normalizedName)) {
    return 'manager';
  }

  return null;
}

export type ReferralGraphRadiusNode = Pick<GraphNode, 'referralCount' | 'inboundCount' | 'highlightType'> & {
  descendantCount?: number | null;
};

export function getReferralGraphNodeRadius(node: ReferralGraphRadiusNode) {
  const hasDescendantCount = node.descendantCount != null;
  const scaleCount = hasDescendantCount
    ? Math.max(0, node.descendantCount ?? 0)
    : Math.max(0, node.referralCount + node.inboundCount);
  const baseRadius = hasDescendantCount
    ? 4.6 + Math.min(Math.log1p(scaleCount) * 2.15, 9.4)
    : 4.6 + Math.min(Math.log1p(scaleCount) * 1.85, 5.1);
  return node.highlightType ? baseRadius + 3.4 : baseRadius;
}

export function getReferralGraphHighlightLabel(highlightType: GraphNodeHighlightType | null) {
  if (highlightType === 'manager') {
    return '본부장 표시';
  }

  if (highlightType === 'viewer') {
    return '현재 사용자';
  }

  return null;
}
