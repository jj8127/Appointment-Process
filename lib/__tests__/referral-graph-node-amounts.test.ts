import { getReferralGraphNodeAmountMetrics, type ReferralGraphNodeAmounts } from '../referral-graph-node-amounts';
import { buildReferralGraphLabels, getReferralGraphLabelSize, getReferralGraphVisualScale, graphRectIntersectsCircle, graphRectsOverlap, REFERRAL_GRAPH_LABEL_GAP, type GraphLabelSize } from '../referral-graph-readable';
import { getReferralGraphNodeScreenRadius } from '../referral-graph-native';
import type { ReferralGraphNode, ReferralGraphPoint } from '@/types/referral-graph';

const nodes: ReferralGraphNode[] = Array.from({ length: 7 }, (_, index) => ({
  id: `n${index}`, name: `가상 ${index}`, affiliation: '', activeCode: null, nodeStatus: 'missing_code',
  signupCompleted: false, allCommissionsCompleted: false, directInviteeCount: 0, totalDescendantCount: 0, isViewer: index === 0,
}));
const positions = new Map<string, ReferralGraphPoint>(nodes.map((node, index) => [node.id, { x: 900 + index * 220, y: 900 + (index % 2) * 220 }]));
const amounts: ReferralGraphNodeAmounts[] = nodes.slice(1).map((node) => ({ nodeId: node.id,
  directText: '직접 −30,000원', totalText: '총 +12,340,000원', directNegative: true, totalNegative: false,
}));
const detailSizes = new Map<string, GraphLabelSize>(amounts.map((amount) => [amount.nodeId, getReferralGraphNodeAmountMetrics(nodes.find((node) => node.id === amount.nodeId)!.name, amount, 1.36)]));

describe('node-owned allowance labels', () => {
  it.each([0.14, 0.42, 1, 1.4])('keeps the complete name/amount block beside its owner without covering other labels or nodes at scale %s', (scale) => {
    const result = buildReferralGraphLabels({ nodes, positions, scale, fontScale: 1.36, detailSizes });
    const expanded = [...result].filter(([, label]) => label.showDetails);
    expect(result.size).toBeGreaterThan(0);
    if (scale >= 1) expect(expanded).toHaveLength(amounts.length);
    const rects = [...result].map(([id, label]) => {
      const point = positions.get(id)!;
      const radius = getReferralGraphNodeScreenRadius(0) * getReferralGraphVisualScale(scale);
      const distanceX = Math.max(label.offsetX, -label.offsetX - label.width, 0);
      const distanceY = Math.max(label.offsetY, -label.offsetY - label.height, 0);
      expect(Math.hypot(distanceX, distanceY)).toBeCloseTo(radius + REFERRAL_GRAPH_LABEL_GAP);
      if (label.showDetails) {
        expect(label.width).toBe(detailSizes.get(id)!.width);
        expect(label.height).toBe(detailSizes.get(id)!.height);
        expect(amounts.some((amount) => amount.nodeId === id)).toBe(true);
      }
      return { x: point.x * scale + label.offsetX, y: point.y * scale + label.offsetY, width: label.width, height: label.height };
    });
    for (const [index, rect] of rects.entries()) {
      for (const other of rects.slice(index + 1)) expect(graphRectsOverlap(rect, other, 4)).toBe(false);
      for (const node of nodes) {
        const point = positions.get(node.id)!;
        expect(graphRectIntersectsCircle(rect, { x: point.x * scale, y: point.y * scale }, getReferralGraphNodeScreenRadius(0) * getReferralGraphVisualScale(scale) + 3)).toBe(false);
      }
    }
  });

  it('falls back to the same node name when its full amount card has no space', () => {
    const crowded = new Map(nodes.slice(0, 5).map((node, index) => [node.id, index === 0 ? { x: 0, y: 0 } : {
      x: index % 2 ? -60 : 60, y: index <= 2 ? -35 : 35,
    }]));
    const result = buildReferralGraphLabels({ nodes: nodes.slice(0, 5), positions: crowded, scale: 1,
      detailSizes: new Map([['n0', { width: 300, height: 120 }]]) });
    expect(result.get('n0')).toMatchObject({ ...getReferralGraphLabelSize(nodes[0].name), showDetails: false });
  });

  it('prioritizes the selected node, ignores absent-node details and preserves inputs', () => {
    const options = { nodes, positions, detailSizes, scale: 1, fontScale: 1.36, selectedNodeId: 'n2' };
    const before = JSON.stringify({ nodes, amounts, positions: [...positions], detailSizes: [...detailSizes] });
    const result = buildReferralGraphLabels(options);
    expect([...result.keys()][0]).toBe('n2');
    expect(result.get('n2')?.showDetails).toBe(true);
    expect(buildReferralGraphLabels({ ...options, nodes: [...nodes].reverse() })).toEqual(result);
    expect(buildReferralGraphLabels({ ...options, detailSizes: new Map([...detailSizes, ['absent', { width: 5000, height: 5000 }]]) })).toEqual(result);
    expect(JSON.stringify({ nodes, amounts, positions: [...positions], detailSizes: [...detailSizes] })).toBe(before);
  });

  it('reserves all three rows and sufficient width for large signed values at larger text sizes', () => {
    const text = { ...amounts[0], totalText: '총 −9,999,999,999,999원' };
    const normal = getReferralGraphNodeAmountMetrics('가상 이름', text);
    const large = getReferralGraphNodeAmountMetrics('가상 이름', text, 2);
    expect(large.width - 12).toBeCloseTo((normal.width - 12) * 2);
    expect(large.height).toBe(large.lineHeight * 3 + large.nameGap + 8);
    expect(getReferralGraphNodeAmountMetrics('가상 이름', text, NaN)).toEqual(normal);
  });
});
