import { buildReferralGraphLayout, getReferralGraphNodeScreenRadius, getReferralGraphRenderSurfaceSize } from '../referral-graph-native';
import {
  buildReadableReferralGraphLayout, buildReferralGraphLabels,
  clampReadableReferralGraphScale, getReadableReferralGraphViewport,
  getReferralGraphLabelSize, getReferralGraphLogicalSurface, getReferralGraphVisualScale, projectReferralGraphPoint,
  type GraphLabelPlacement,
} from '../referral-graph-readable';
import { fictionalStressDownline, graphCases, graphFromParents } from './fixtures/referral-graph-fixtures';
import type { ReferralGraphNode, ReferralGraphPoint } from '@/types/referral-graph';

// Independent geometric oracle: deliberately does not call production collision helpers.
function audit(nodes: ReferralGraphNode[], positions: Map<string, ReferralGraphPoint>, zoom: number,
  labels = new Map<string, GraphLabelPlacement>(), selectedNodeId: string | null = null) {
  let minDistance = Infinity;
  let nodeOverlaps = 0;
  let labelOverlaps = 0;
  let labelNodeOverlaps = 0;
  const circles = nodes.map((node) => ({ id: node.id,
    x: positions.get(node.id)!.x * zoom, y: positions.get(node.id)!.y * zoom,
    r: (getReferralGraphNodeScreenRadius(node.totalDescendantCount) + (node.id === selectedNodeId ? 9 : 0)) * getReferralGraphVisualScale(zoom),
  }));
  const boxes = Array.from(labels, ([id, label]) => {
    const point = positions.get(id)!;
    const left = point.x * zoom + label.offsetX;
    const top = point.y * zoom + label.offsetY;
    return { left, top, right: left + label.width, bottom: top + label.height };
  });
  for (let a = 0; a < circles.length; a += 1) {
    for (let b = a + 1; b < circles.length; b += 1) {
      const distance = Math.hypot(circles[a].x - circles[b].x, circles[a].y - circles[b].y);
      minDistance = Math.min(minDistance, distance);
      if (distance < circles[a].r + circles[b].r - 1e-6) nodeOverlaps += 1;
    }
  }
  for (let a = 0; a < boxes.length; a += 1) {
    const box = boxes[a];
    for (let b = a + 1; b < boxes.length; b += 1) {
      const other = boxes[b];
      if (Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1e-6
        && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1e-6) labelOverlaps += 1;
    }
    for (const circle of circles) {
      const dx = Math.max(box.left - circle.x, 0, circle.x - box.right);
      const dy = Math.max(box.top - circle.y, 0, circle.y - box.bottom);
      if (dx * dx + dy * dy < circle.r * circle.r - 1e-6) labelNodeOverlaps += 1;
    }
  }
  return { nodeOverlaps, labelOverlaps, labelNodeOverlaps, minDistance, visibleLabels: labels.size };
}

describe.each(graphCases())('$name', ({ nodes, edges }) => {
  const positions = buildReadableReferralGraphLayout(nodes, edges);
  const fit = getReadableReferralGraphViewport({ positions, width: 360, height: 520 });
  it.each([0.31, 0.5, 1, 1.4, 3, 6])('has no circle or visible label intersections at zoom %s', (scale) => {
    const labels = buildReferralGraphLabels({ nodes, positions, scale });
    const result = audit(nodes, positions, scale, labels);
    expect(result.nodeOverlaps).toBe(0);
    expect(result.labelOverlaps).toBe(0);
    expect(result.labelNodeOverlaps).toBe(0);
    expect(positions.size).toBe(nodes.length);
    if (scale >= 1) {
      expect(result.minDistance).toBeGreaterThanOrEqual(48);
      expect(labels.size).toBe(nodes.length);
    }
  });
  it('fits every node without overlap in portrait and landscape', () => {
    for (const [width, height] of [[320, 480], [360, 520], [430, 800], [800, 350]]) {
      const viewport = getReadableReferralGraphViewport({ positions, width, height });
      const labels = buildReferralGraphLabels({ nodes, positions, scale: viewport.scale });
      const result = audit(nodes, positions, viewport.scale, labels);
      expect(result.nodeOverlaps + result.labelOverlaps + result.labelNodeOverlaps).toBe(0);
      for (const point of positions.values()) {
        const screen = projectReferralGraphPoint(point, viewport.scale, viewport.panX, viewport.panY, width, height);
        expect(screen.x).toBeGreaterThanOrEqual(0);
        expect(screen.x).toBeLessThanOrEqual(width);
        expect(screen.y).toBeGreaterThanOrEqual(0);
        expect(screen.y).toBeLessThanOrEqual(height);
      }
    }
  });
  it('does not change positions or label choices when input order reverses', () => {
    expect(Array.from(buildReadableReferralGraphLayout(nodes.slice().reverse(), edges.slice().reverse())))
      .toEqual(Array.from(positions));
    expect(Array.from(buildReferralGraphLabels({ nodes: nodes.slice().reverse(), positions, scale: fit.scale })))
      .toEqual(Array.from(buildReferralGraphLabels({ nodes, positions, scale: fit.scale })));
  });
});

describe('readable native graph boundaries', () => {
  it('reproduces and removes the fictional stress topology overlap at compact zoom', () => {
    const { nodes, edges } = fictionalStressDownline();
    expect(nodes).toHaveLength(295);
    expect(edges).toHaveLength(294);
    expect(nodes[0].directInviteeCount).toBe(21);
    expect(audit(nodes, buildReferralGraphLayout(nodes, edges), 0.31).nodeOverlaps).toBeGreaterThan(0);
    const positions = buildReadableReferralGraphLayout(nodes, edges);
    expect(audit(nodes, positions, 0.31).nodeOverlaps).toBe(0);
    // A non-overlap solver must not pass by exploding the drawing into an unusable world.
    expect(getReadableReferralGraphViewport({ positions, width: 360, height: 520 }).scale).toBeGreaterThan(0.04);
  });
  it('extends logical space while keeping high-density bitmap sides bounded', () => {
    const { nodes, edges } = graphCases()[1];
    const positions = buildReadableReferralGraphLayout(nodes, edges);
    expect(getReferralGraphLogicalSurface(positions).size).toBeGreaterThan(1800);
    for (const density of [1, 2, 3, 4.25]) {
      expect(Math.ceil(getReferralGraphRenderSurfaceSize(density) * density)).toBeLessThanOrEqual(2048);
    }
    const fit = getReadableReferralGraphViewport({ positions, width: 360, height: 520 });
    expect(fit.scale).toBeLessThan(0.25);
    expect(clampReadableReferralGraphScale(0, fit.scale)).toBe(fit.scale);
    expect(clampReadableReferralGraphScale(100, fit.scale)).toBe(6);
  });
  it('keeps the compact radial-track tradeoff bounded on the fictional stress topology', () => {
    const { nodes, edges } = fictionalStressDownline();
    const positions = buildReadableReferralGraphLayout(nodes, edges);
    const turn = (a: ReferralGraphPoint, b: ReferralGraphPoint, c: ReferralGraphPoint) =>
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    let crossings = 0;
    for (let i = 0; i < edges.length; i += 1) for (let j = i + 1; j < edges.length; j += 1) {
      const e = edges[i];
      const f = edges[j];
      if ([e.source, e.target].some((id) => id === f.source || id === f.target)) continue;
      const a = positions.get(e.source)!;
      const b = positions.get(e.target)!;
      const c = positions.get(f.source)!;
      const d = positions.get(f.target)!;
      if (turn(a, b, c) * turn(a, b, d) < -1e-7 && turn(c, d, a) * turn(c, d, b) < -1e-7) crossings += 1;
    }
    // Radial tracks trade one straight-edge crossing for compact, separated nodes.
    expect(crossings).toBeLessThanOrEqual(1);
  });
  it('preserves the same world point through camera zoom and pan', () => {
    const point = { x: 12345, y: -4321 };
    const scale = 0.31;
    const screen = projectReferralGraphPoint(point, scale, 17, -23, 360, 520);
    expect((screen.x - 17 - 180) / scale + 900).toBeCloseTo(point.x);
    expect((screen.y + 23 - 260) / scale + 900).toBeCloseTo(point.y);
  });
  it('handles empty, single, cycle, duplicated, and disconnected nodes without data mutation', () => {
    expect(buildReadableReferralGraphLayout([], []).size).toBe(0);
    expect(getReadableReferralGraphViewport({ positions: new Map(), width: 0, height: 0 }).scale).toBe(1);
    const { nodes, edges } = graphFromParents([-1, 0, 1, -1, 3]);
    edges.push({ id: 'cycle', source: nodes[2].id, target: nodes[0].id });
    const snapshot = JSON.stringify({ nodes, edges });
    const positions = buildReadableReferralGraphLayout([...nodes, nodes[0]], [...edges, edges[0]]);
    expect(positions.size).toBe(5);
    expect(audit(nodes, positions, 1).nodeOverlaps).toBe(0);
    expect(JSON.stringify({ nodes, edges })).toBe(snapshot);
    const single = buildReadableReferralGraphLayout([nodes[0]], []);
    expect(single.get(nodes[0].id)).toEqual({ x: 900, y: 900 });
  });
  it('accounts for large system text and selection rings', () => {
    const { nodes, edges } = fictionalStressDownline();
    const positions = buildReadableReferralGraphLayout(nodes, edges, 2);
    for (const scale of [0.31, 1, 6]) {
      const selectedNodeId = nodes[80].id;
      const labels = buildReferralGraphLabels({ nodes, positions, scale, selectedNodeId, fontScale: 2 });
      const result = audit(nodes, positions, scale, labels, selectedNodeId);
      expect(result.labelNodeOverlaps + result.labelOverlaps + result.nodeOverlaps).toBe(0);
      if (scale >= 1) expect(labels.has(selectedNodeId)).toBe(true);
    }
    expect(getReferralGraphLabelSize('WWW 긴 이름입니다', 2).height).toBe(28);
  });
});
