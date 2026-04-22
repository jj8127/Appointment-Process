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
  const baseRadius = 8 + Math.min(node.referralCount + node.inboundCount, 16) * 0.55;
  return node.highlightType ? baseRadius + 5.5 : baseRadius;
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
