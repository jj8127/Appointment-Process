import type { GraphNode, GraphNodeHighlightType } from '@/types/referral-graph';

export const SPECIAL_REFERRAL_GRAPH_HIGHLIGHT_NAMES = new Set(['김형수']);

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

  if (SPECIAL_REFERRAL_GRAPH_HIGHLIGHT_NAMES.has(normalizedName)) {
    return 'special';
  }

  if (input.isManagerReferralShadow === true) {
    return 'manager';
  }

  if (input.managerNames?.has(normalizedName)) {
    return 'manager';
  }

  return null;
}

export function getReferralGraphNodeRadius(node: Pick<GraphNode, 'referralCount' | 'inboundCount' | 'highlightType'>) {
  const linkCount = Math.max(0, node.referralCount + node.inboundCount);
  const baseRadius = 4.6 + Math.min(Math.log1p(linkCount) * 1.85, 5.1);
  return node.highlightType ? baseRadius + 3.4 : baseRadius;
}

export function getReferralGraphHighlightLabel(highlightType: GraphNodeHighlightType | null) {
  if (highlightType === 'manager') {
    return '본부장 표시';
  }

  if (highlightType === 'special') {
    return '김형수 표시';
  }

  return null;
}
