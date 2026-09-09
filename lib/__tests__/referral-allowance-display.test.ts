import { buildReferralAllowanceGraph, buildReferralAllowanceNodeAmounts, buildReferralAllowancePathTotals, formatReferralAllowanceKrw, formatReferralAllowancePerformanceKrw, getReferralAllowanceAncestorPath } from '../referral-allowance-display';
import type { ReferralAllowanceNode, ReferralAllowanceStatement } from '@/types/referral-allowance';

function node(id: string, parentId: string | null, depth: number, contributionKrw: number): ReferralAllowanceNode {
  return { id, parentId, depth, name: `가상 ${id}`, affiliation: '가상 조직', isBeneficiary: parentId === null,
    activeAtPerformance: true, eligibleAtBasisDate: true, finalTargetPerformanceKrw: contributionKrw * 10,
    fpRoundedAmountKrw: contributionKrw, contributionKrw };
}

function statement(nodes: ReferralAllowanceNode[]): ReferralAllowanceStatement {
  return { schemaVersion: 1, policyVersion: 'recruitment-2026-09-07-snapshot-pilot-v1', performanceMonth: '2026-06',
    paymentDate: '2026-08-01', genealogyAsOf: '2026-07-31', eligibilityBasis: 'uploaded_snapshot',
    sourceSnapshotDates: ['2026-07-27', '2026-08-02'], usesLaterSnapshot: true, status: 'current_month_estimate', previousCarryIncluded: false,
    beneficiary: { nodeId: 'root', name: '가상 수령인', eligibleAtBasisDate: true }, nodes,
    summary: { currentMonthNetKrw: 40000, newPaymentKrw: 40000, carryForwardKrw: 0, extinguishedKrw: 0, excludedByEligibilityKrw: 0 },
    validation: { visiblePeopleCount: nodes.length, contributorCount: nodes.length - 1, maximumDepth: 10, conservationDifferenceKrw: 0 } };
}

describe('allowance display preserves the published signed amounts', () => {
  it('formats negative, positive, and zero amounts without rounding or losing their sign', () => {
    expect(formatReferralAllowanceKrw(-12345, true)).toBe('−12,345원');
    expect(formatReferralAllowanceKrw(12345, true)).toBe('+12,345원');
    expect(formatReferralAllowanceKrw(0, true)).toBe('0원');
    expect(formatReferralAllowanceKrw(-0, true)).toBe('0원');
    expect(() => formatReferralAllowanceKrw(NaN)).toThrow();
    expect(() => formatReferralAllowanceKrw(10.9)).toThrow();
  });

  it('subtracts a negative contributor along the complete ancestor path', () => {
    const nodes = [node('root', null, 0, 0), node('branch', 'root', 1, 10000), node('positive', 'branch', 2, 60000), node('negative', 'branch', 2, -30000)];
    const totals = buildReferralAllowancePathTotals(nodes);
    expect(totals.get('negative')).toBe(-30000);
    expect(totals.get('branch')).toBe(40000);
    expect(totals.get('root')).toBe(40000);
    expect(getReferralAllowanceAncestorPath(nodes, 'negative').map((item) => item.id)).toEqual(['negative', 'branch', 'root']);
    const amounts = buildReferralAllowanceNodeAmounts(statement(nodes));
    expect(amounts.find((label) => label.nodeId === 'branch')).toMatchObject({ directText: '직접 +10,000원', totalText: '총 +40,000원', totalNegative: false });
    expect(amounts.find((label) => label.nodeId === 'negative')).toMatchObject({ directText: '직접 −30,000원', totalText: '총 −30,000원', directNegative: true, totalNegative: true });
    expect(amounts.find((label) => label.nodeId === 'root')).toBeUndefined();
  });

  it('displays fractional source performance without rejecting or truncating valid sales', () => {
    expect(formatReferralAllowancePerformanceKrw(12345.25)).toBe('12,345.25원');
    expect(formatReferralAllowancePerformanceKrw(-12345.5)).toBe('−12,345.5원');
    expect(formatReferralAllowancePerformanceKrw(0)).toBe('0원');
    expect(formatReferralAllowancePerformanceKrw(-0)).toBe('0원');
    expect(() => formatReferralAllowancePerformanceKrw(NaN)).toThrow();
  });

  it('bounds only graph primitives and preserves the complete statement and signed totals', () => {
    const nodes = [node('root', null, 0, 0), node('branch', 'root', 1, 0),
      ...Array.from({ length: 500 }, (_, index) => node(`child-${index}`, 'branch', 2, index % 2 ? -10000 : 20000))];
    const source = statement(nodes);
    const before = JSON.stringify(source);
    const graph = buildReferralAllowanceGraph(source);
    const ids = new Set(graph.nodes.map((item) => item.id));
    expect(graph.nodes).toHaveLength(300);
    expect(graph.totalNodeCount).toBe(502);
    expect(graph.omittedNodeCount).toBe(202);
    expect(graph.edges).toHaveLength(299);
    expect(graph.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
    expect(graph.nodes.find((item) => item.id === 'branch')?.totalDescendantCount).toBe(500);
    expect(buildReferralAllowancePathTotals(source.nodes).get('root')).toBe(2500000);
    expect(buildReferralAllowanceNodeAmounts(source).find((label) => label.nodeId === 'branch'))
      .toMatchObject({ directText: '직접 0원', totalText: '총 +2,500,000원' });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('does not fabricate ancestry for nodes whose parent is absent', () => {
    const source = statement([node('root', null, 0, 0), node('orphan', 'missing', 3, 10000)]);
    expect(buildReferralAllowanceGraph(source).nodes.map((item) => item.id)).toEqual(['root']);
    expect(buildReferralAllowanceGraph(source).edges).toEqual([]);
  });
});
