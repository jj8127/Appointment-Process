import type { ReferralAllowanceNode, ReferralAllowanceStatement } from '@/types/referral-allowance';
import type { ReferralGraphEdge, ReferralGraphNode } from '@/types/referral-graph';
import type { ReferralGraphNodeAmounts } from './referral-graph-node-amounts';

export const REFERRAL_ALLOWANCE_GRAPH_LIMIT = 300;

export function formatReferralAllowanceKrw(amount: number, signed = false) {
  if (!Number.isSafeInteger(amount)) throw new Error('수당 금액 형식을 확인해주세요.');
  const prefix = amount < 0 ? '−' : signed && amount > 0 ? '+' : '';
  return `${prefix}${Math.abs(amount).toLocaleString('ko-KR')}원`;
}

/** Source performance can include hundredths; published allowances remain integral. */
export function formatReferralAllowancePerformanceKrw(amount: number) {
  if (!Number.isFinite(amount) || Math.abs(amount) > 1e12) throw new Error('매출 금액 형식을 확인해주세요.');
  return `${amount < 0 ? '−' : ''}${Math.abs(amount).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`;
}

export function formatReferralAllowanceMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return month;
  return `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
}

/** Display aggregation only: preserves server-calculated positive and negative contributions. */
export function buildReferralAllowancePathTotals(nodes: readonly ReferralAllowanceNode[]) {
  const totals = new Map(nodes.map((node) => [node.id, node.contributionKrw]));
  for (const node of [...nodes].sort((a, b) => b.depth - a.depth)) {
    if (node.parentId !== null && totals.has(node.parentId)) {
      totals.set(node.parentId, totals.get(node.parentId)! + totals.get(node.id)!);
    }
  }
  return totals;
}

/** Totals include the full published branch, even when graph nodes are omitted. */
export function buildReferralAllowanceNodeAmounts(statement: ReferralAllowanceStatement): ReferralGraphNodeAmounts[] {
  const totals = buildReferralAllowancePathTotals(statement.nodes);
  return statement.nodes.flatMap((node) => {
    if (node.parentId === null) return [];
    const total = totals.get(node.id) ?? node.contributionKrw;
    return [{ nodeId: node.id,
      directText: `직접 ${formatReferralAllowanceKrw(node.contributionKrw, true)}`,
      totalText: `총 ${formatReferralAllowanceKrw(total, true)}`,
      directNegative: node.contributionKrw < 0, totalNegative: total < 0,
    }];
  });
}

export function getReferralAllowanceAncestorPath(nodes: readonly ReferralAllowanceNode[], nodeId: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const path: ReferralAllowanceNode[] = [];
  const seen = new Set<string>();
  let current = byId.get(nodeId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

/** Parent-first mounting bounds graph work; the statement and its totals remain complete. */
export function buildReferralAllowanceGraph(statement: ReferralAllowanceStatement, limit = REFERRAL_ALLOWANCE_GRAPH_LIMIT) {
  const byId = new Map(statement.nodes.map((node) => [node.id, node]));
  const children = new Map<string, ReferralAllowanceNode[]>();
  for (const node of statement.nodes) {
    if (node.parentId !== null) {
      const siblings = children.get(node.parentId) ?? [];
      siblings.push(node);
      children.set(node.parentId, siblings);
    }
  }
  const descendantCounts = new Map(statement.nodes.map((node) => [node.id, 0]));
  for (const node of [...statement.nodes].sort((a, b) => b.depth - a.depth)) {
    if (node.parentId && descendantCounts.has(node.parentId)) {
      descendantCounts.set(node.parentId, descendantCounts.get(node.parentId)! + descendantCounts.get(node.id)! + 1);
    }
  }
  const root = byId.get(statement.beneficiary.nodeId);
  const queue = root ? [root] : [];
  const included = new Set<string>();
  const sourceNodes: ReferralAllowanceNode[] = [];
  const cap = Math.max(1, Math.min(REFERRAL_ALLOWANCE_GRAPH_LIMIT, Math.floor(limit)));
  for (let cursor = 0; cursor < queue.length && sourceNodes.length < cap; cursor += 1) {
    const node = queue[cursor];
    if (included.has(node.id)) continue;
    included.add(node.id);
    sourceNodes.push(node);
    queue.push(...(children.get(node.id) ?? []));
  }
  const nodes: ReferralGraphNode[] = sourceNodes.map((node) => ({
    id: node.id, name: node.name, affiliation: node.affiliation,
    activeCode: null, nodeStatus: 'missing_code', signupCompleted: false,
    allCommissionsCompleted: false, isViewer: node.isBeneficiary,
    directInviteeCount: children.get(node.id)?.length ?? 0,
    totalDescendantCount: descendantCounts.get(node.id) ?? 0,
  }));
  const edges: ReferralGraphEdge[] = sourceNodes.flatMap((node) => node.parentId && included.has(node.parentId)
    ? [{ id: `${node.parentId}__${node.id}`, source: node.parentId, target: node.id }] : []);
  return { nodes, edges, totalNodeCount: statement.nodes.length, omittedNodeCount: statement.nodes.length - nodes.length };
}
