import { buildReferralGraphRenderSet, getReferralGraphPrimitivePadding } from '../referral-graph-render-model';
import { buildReadableReferralGraphLayout, buildReferralGraphLabels, getReadableReferralGraphViewport, getReferralGraphLabelSize, getReferralGraphVisualScale, projectReferralGraphPoint } from '../referral-graph-readable';
import { REFERRAL_GRAPH_SURFACE_CENTER, getReferralGraphNodeScreenRadius } from '../referral-graph-native';
import { graphFromParents } from './fixtures/referral-graph-fixtures';

const graph = graphFromParents(Array.from({ length: 300 }, (_, index) => index === 0 ? -1 : Math.floor((index - 1) / 3)));
const positions = buildReadableReferralGraphLayout(graph.nodes, graph.edges);
const size = { width: 360, height: 640 };
const primitivePadding = getReferralGraphPrimitivePadding(graph.nodes, 1);

describe('bounded referral graph rendering', () => {
  it('retains the entire graph at fit and prunes mounted nodes when reading', () => {
    const fit = getReadableReferralGraphViewport({ positions, ...size });
    const overview = buildReferralGraphRenderSet({ ...graph, positions, primitivePadding, camera: { ...fit, ...size } });
    expect(overview.positionedNodes).toHaveLength(300);
    expect(overview.edgeCount).toBe(299);
    const reading = buildReferralGraphRenderSet({ ...graph, positions, primitivePadding, camera: { ...size, scale: 1, panX: 0, panY: 0 } });
    expect(reading.positionedNodes.length).toBeGreaterThan(0);
    expect(reading.positionedNodes.length).toBeLessThan(150);
    expect(reading.edgeCount).toBeLessThan(299);
    expect(graph.nodes).toHaveLength(300);
    expect(positions.size).toBe(300);
  });

  it('keeps all accessible nodes and original edges with the full-render fallback', () => {
    const result = buildReferralGraphRenderSet({ ...graph, positions, primitivePadding, renderAll: true,
      camera: { ...size, scale: 6, panX: 100000, panY: -100000 } });
    expect(result.positionedNodes).toHaveLength(300);
    expect(result.edgeCount).toBe(299);
    expect(result.edgePath.match(/M/g)).toHaveLength(299);
  });

  it('keeps screen-crossing edges with both endpoints outside and independent subpaths', () => {
    const [a, b, c] = graph.nodes;
    const center = REFERRAL_GRAPH_SURFACE_CENTER;
    const customPositions = new Map([
      [a.id, { x: center - 2000, y: center }],
      [b.id, { x: center + 2000, y: center }],
      [c.id, { x: center + 2000, y: center + 2000 }],
    ]);
    const result = buildReferralGraphRenderSet({ nodes: [a, b, c], positions: customPositions, primitivePadding,
      edges: [{ id: 'crossing', source: a.id, target: b.id }, { id: 'outside', source: b.id, target: c.id },
        { id: 'missing', source: a.id, target: 'absent' }],
      camera: { ...size, scale: 1, panX: 0, panY: 0 } });
    expect(result.positionedNodes).toHaveLength(0);
    expect(result.edgeCount).toBe(1);
    expect(result.edgePath).toBe('M-2000 0L2000 0');
  });

  it.each([1, 2, 3])('never removes a visible label, circle, or hit target at font scale %s', (fontScale) => {
    const padding = getReferralGraphPrimitivePadding(graph.nodes, fontScale);
    for (const scale of [0.1, 0.31, 1, 3, 6]) {
      const labels = buildReferralGraphLabels({ nodes: graph.nodes, positions, scale, fontScale });
      for (const pan of [-700, 0, 500]) {
        const camera = { ...size, scale, panX: pan, panY: -pan / 2 };
        const rendered = buildReferralGraphRenderSet({ ...graph, positions, primitivePadding: padding, camera });
        const ids = new Set(rendered.positionedNodes.map(({ node }) => node.id));
        for (const node of graph.nodes) {
          const point = projectReferralGraphPoint(positions.get(node.id)!, scale, camera.panX, camera.panY, size.width, size.height);
          const radius = Math.max(24, (getReferralGraphNodeScreenRadius(node.totalDescendantCount) + 9) * getReferralGraphVisualScale(scale));
          if (point.x + radius >= 0 && point.x - radius <= size.width && point.y + radius >= 0 && point.y - radius <= size.height) {
            expect(ids.has(node.id)).toBe(true);
          }
          const label = labels.get(node.id);
          if (!label) continue;
          const left = point.x + label.offsetX;
          const top = point.y + label.offsetY;
          if (left + label.width >= 0 && left <= size.width && top + label.height >= 0 && top <= size.height) {
            expect(ids.has(node.id)).toBe(true);
          }
        }
      }
    }
  });

  it('includes full side-label extent in the padding rather than only its half width', () => {
    const node = { ...graph.nodes[0], name: '가상긴이름확인전용열글자', totalDescendantCount: 299 };
    const label = getReferralGraphLabelSize(node.name, 3);
    const radius = getReferralGraphNodeScreenRadius(node.totalDescendantCount) * 1.4;
    expect(getReferralGraphPrimitivePadding([node], 3)).toBeGreaterThan(radius + 6 + label.width);
  });
});
