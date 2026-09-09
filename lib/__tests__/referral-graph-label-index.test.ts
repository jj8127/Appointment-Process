import {
  buildReadableReferralGraphLayout,
  buildReferralGraphLabels,
  getReferralGraphLabelSize,
  getReferralGraphVisualScale,
  REFERRAL_GRAPH_LABEL_GAP,
  type GraphLabelPlacement,
  type GraphRect,
} from '../referral-graph-readable';
import { getReferralGraphNodeScreenRadius } from '../referral-graph-native';
import type { ReferralGraphNode, ReferralGraphPoint } from '@/types/referral-graph';

type LabelOptions = Parameters<typeof buildReferralGraphLabels>[0];

// The previous exhaustive algorithm is an oracle for exact choices and insertion order.
// It deliberately has no grid, indexed lookup, or production collision helper calls.
function bruteForceLabels({ nodes, positions, scale, selectedNodeId, fontScale = 1 }: LabelOptions) {
  const result = new Map<string, GraphLabelPlacement>();
  const occupied: GraphRect[] = [];
  const priority = (node: ReferralGraphNode) => node.id === selectedNodeId ? 2 : node.isViewer ? 1 : 0;
  const sorted = nodes.slice().sort((a, b) => priority(b) - priority(a)
    || b.totalDescendantCount - a.totalDescendantCount || a.id.localeCompare(b.id));
  const circles = nodes.flatMap((node) => {
    const point = positions.get(node.id);
    return point ? [{ id: node.id, x: point.x * scale, y: point.y * scale,
      radius: getReferralGraphNodeScreenRadius(node.totalDescendantCount) * getReferralGraphVisualScale(scale)
        + (node.id === selectedNodeId ? 9 * getReferralGraphVisualScale(scale) : 0) }] : [];
  });
  for (const node of sorted) {
    const point = positions.get(node.id);
    if (!point) continue;
    const { width, height } = getReferralGraphLabelSize(node.name, fontScale);
    const circle = circles.find((item) => item.id === node.id)!;
    const offset = circle.radius + REFERRAL_GRAPH_LABEL_GAP;
    for (const candidate of [
      { offsetX: -width / 2, offsetY: offset },
      { offsetX: offset, offsetY: -height / 2 },
      { offsetX: -width - offset, offsetY: -height / 2 },
      { offsetX: -width / 2, offsetY: -height - offset },
    ]) {
      const rect = { x: point.x * scale + candidate.offsetX, y: point.y * scale + candidate.offsetY, width, height };
      if (occupied.some((other) => rect.x < other.x + other.width + 4
        && rect.x + rect.width + 4 > other.x && rect.y < other.y + other.height + 4
        && rect.y + rect.height + 4 > other.y)) continue;
      if (circles.some((other) => {
        const x = Math.max(rect.x, Math.min(rect.x + rect.width, other.x));
        const y = Math.max(rect.y, Math.min(rect.y + rect.height, other.y));
        return Math.hypot(x - other.x, y - other.y) < other.radius + 3;
      })) continue;
      occupied.push(rect);
      result.set(node.id, { ...candidate, width, height });
      break;
    }
  }
  return result;
}

function fictionalNodes(count: number): ReferralGraphNode[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `fictional-${String(index).padStart(3, '0')}`,
    name: index % 7 ? `가상${index}` : '긴 가상 이름과 Emoji 🌱 표시',
    affiliation: '', activeCode: null, nodeStatus: 'missing_code',
    signupCompleted: false, allCommissionsCompleted: false,
    directInviteeCount: 0, totalDescendantCount: (index * 37) % 300,
    isViewer: index === 0,
  }));
}

function treeCase(name: string, parent: (index: number) => number) {
  const nodes = fictionalNodes(300);
  const edges = nodes.slice(1).map((node, index) => ({
    id: `fictional-edge-${index + 1}`, source: nodes[parent(index + 1)].id, target: node.id,
  }));
  return { name, nodes, positions: buildReadableReferralGraphLayout(nodes, edges) };
}

function positionedCase(name: string, point: (index: number) => ReferralGraphPoint) {
  const nodes = fictionalNodes(120);
  return { name, nodes, positions: new Map(nodes.map((node, index) => [node.id, point(index)])) };
}

const cases = [
  treeCase('300-node star', () => 0),
  treeCase('300-node balanced tree', (index) => Math.floor((index - 1) / 3)),
  treeCase('300-node deep chain', (index) => index - 1),
  treeCase('heavy branch with small siblings', (index) => index < 4 ? 0 : 1),
  positionedCase('dense points across negative grid boundaries', (index) => ({
    x: (index % 12) * 8 - 64.00001, y: Math.floor(index / 12) * 9 - 64,
  })),
  positionedCase('sparse disconnected points', (index) => ({
    x: (index % 12) * 4096 - 20000, y: Math.floor(index / 12) * 8192 - 30000,
  })),
];

describe.each(cases)('indexed labels: $name', ({ nodes, positions }) => {
  it.each([0.005, 0.04, 0.1, 0.31, 1, 1.4, 3, 6])('matches every brute-force placement at scale %s', (scale) => {
    for (const fontScale of [1, 2, 4]) {
      for (const selectedNodeId of [null, nodes[37].id]) {
        const options = { nodes, positions, scale, fontScale, selectedNodeId };
        expect(Array.from(buildReferralGraphLabels(options))).toEqual(Array.from(bruteForceLabels(options)));
      }
    }
  });

  it('preserves output when inputs reverse without mutating nodes or positions', () => {
    const originalNodes = JSON.stringify(nodes);
    const originalPositions = Array.from(positions);
    const options = { nodes, positions, scale: 0.31, selectedNodeId: nodes[37].id, fontScale: 2 };
    const expected = Array.from(bruteForceLabels(options));
    expect(Array.from(buildReferralGraphLabels({ ...options, nodes: nodes.slice().reverse() }))).toEqual(expected);
    expect(JSON.stringify(nodes)).toBe(originalNodes);
    expect(Array.from(positions)).toEqual(originalPositions);
  });
});

describe('indexed label boundaries', () => {
  it('preserves empty, absent-position, and duplicate-ID behavior including first-match radius', () => {
    const base = fictionalNodes(4);
    const nodes = [base[0], { ...base[1], totalDescendantCount: 0 }, base[2],
      { ...base[1], totalDescendantCount: 100000 }, base[3]];
    const positions = new Map([[base[0].id, { x: -64, y: 0 }], [base[1].id, { x: 64, y: 0 }],
      [base[2].id, { x: 128, y: 64 }]]);
    for (const selectedNodeId of [null, base[1].id]) {
      const options = { nodes, positions, scale: 1, selectedNodeId };
      expect(Array.from(buildReferralGraphLabels(options))).toEqual(Array.from(bruteForceLabels(options)));
    }
    expect(buildReferralGraphLabels({ nodes: [], positions: new Map(), scale: 1 }).size).toBe(0);
  });

  it('retains exact gap and circle tangency decisions on cell boundaries', () => {
    const nodes = fictionalNodes(24).map((node) => ({ ...node, name: '가', totalDescendantCount: 0 }));
    for (const epsilon of [-0.000001, 0, 0.000001]) {
      const positions = new Map(nodes.map((node, index) => [node.id, {
        x: (index % 6) * (38 + epsilon) - 64,
        y: Math.floor(index / 6) * (39 + epsilon) - 64,
      }]));
      const options = { nodes, positions, scale: 1, selectedNodeId: nodes[5].id };
      expect(Array.from(buildReferralGraphLabels(options))).toEqual(Array.from(bruteForceLabels(options)));
    }
  });

  it('falls back to bounded scans for oversized text or non-finite coordinates', () => {
    const nodes = fictionalNodes(4);
    const positions = new Map(nodes.map((node, index) => [node.id, { x: index * 100000, y: index * 128 }]));
    for (const fontScale of [1000, 1000000]) {
      const options = { nodes, positions, scale: 1, fontScale };
      expect(Array.from(buildReferralGraphLabels(options))).toEqual(Array.from(bruteForceLabels(options)));
    }
    positions.set(nodes[0].id, { x: Number.POSITIVE_INFINITY, y: 0 });
    const options = { nodes, positions, scale: 1 };
    expect(Array.from(buildReferralGraphLabels(options))).toEqual(Array.from(bruteForceLabels(options)));
  });
});
