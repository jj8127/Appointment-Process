import { buildClusterCore, type CoreNode } from './referral-graph-cluster-core.ts';

export type ClusterLayoutInput = {
  nodes: { id: string; radius: number }[];
  edges: { source: string; target: string }[];
};

export type ClusterLayoutResult = {
  positions: { id: string; x: number; y: number; radius: number }[];
  clusters: { id: string; x: number; y: number; radius: number; memberIds: string[] }[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Unique, valid edges excluded from the directed spanning forest (cycles/multiple parents). */
  extraEdgeCount: number;
};

const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const radiusOf = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0
  ? Math.max(1, Math.min(256, value)) : 8;

/**
 * Worker-safe input contains identifiers and geometry only. Invalid endpoints and
 * duplicate edges are ignored; renderer callers retain their original edge list.
 * Each normal forest edge is represented by a backbone or a direct-leaf spoke.
 */
export function buildReferralClusterLayout(input: ClusterLayoutInput): ClusterLayoutResult {
  const radii = new Map<string, number>();
  for (const node of Array.isArray(input?.nodes) ? input.nodes : []) {
    if (!node || !validId(node.id)) continue;
    // Max is deterministic even when duplicate IDs arrive in a different order.
    radii.set(node.id, Math.max(radii.get(node.id) ?? 0, radiusOf(node.radius)));
  }
  const ids = [...radii.keys()].sort(compareIds);
  const empty: ClusterLayoutResult = { positions: [], clusters: [],
    bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 }, extraEdgeCount: 0 };
  if (!ids.length) return empty;

  const uniqueEdges = new Map<string, { source: string; target: string }>();
  for (const edge of Array.isArray(input?.edges) ? input.edges : []) {
    if (!edge || !validId(edge.source) || !validId(edge.target) || !radii.has(edge.source) || !radii.has(edge.target)) continue;
    uniqueEdges.set(JSON.stringify([edge.source, edge.target]), { source: edge.source, target: edge.target });
  }
  const edges = [...uniqueEdges.values()].sort((a, b) => compareIds(a.source, b.source) || compareIds(a.target, b.target));
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  const incoming = new Map(ids.map((id) => [id, 0]));
  for (const edge of edges) {
    outgoing.get(edge.source)!.push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
  }
  const parents = new Map<string, string | null>();
  const depths = new Map<string, number>();
  const components: string[][] = [];
  let selectedEdges = 0;
  const visit = (root: string) => {
    if (parents.has(root)) return;
    parents.set(root, null);
    depths.set(root, 0);
    const queue = [root];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const source = queue[cursor];
      for (const target of outgoing.get(source)!) {
        if (parents.has(target)) continue;
        parents.set(target, source);
        depths.set(target, depths.get(source)! + 1);
        selectedEdges += 1;
        queue.push(target);
      }
    }
    components.push(queue);
  };
  for (const id of ids) if (incoming.get(id) === 0) visit(id);
  for (const id of ids) visit(id); // A deterministic root also breaks rootless cycles.
  const hubCount = new Set([...parents.values()].filter((id): id is string => id !== null)).size;
  // Bound aggregate worker work as well as each component's iterative solver.
  const allowCompaction = hubCount <= 500;

  const layouts = components.map((members) => {
    const root = members[0];
    const canonical = [root, ...members.filter((id) => id !== root).sort(compareIds)];
    const indexById = new Map(canonical.map((id, index) => [id, index]));
    const nodes: CoreNode[] = canonical.map((id, index) => ({ id: index,
      parent: parents.get(id) === null ? null : indexById.get(parents.get(id)!)!,
      depth: depths.get(id)!, radius: radii.get(id)! }));
    const layout = buildClusterCore(nodes, allowCompaction);
    const positions = canonical.map((id, index) => ({ id, ...layout.positions.get(index)!, radius: radii.get(id)! }));
    const clusters = layout.clusters.map((cluster) => ({ ...cluster, id: canonical[cluster.id],
      memberIds: cluster.memberIds.map((id) => canonical[id]) }));
    const bounds = clusters.reduce((box, cluster) => ({
      minX: Math.min(box.minX, cluster.x - cluster.radius), minY: Math.min(box.minY, cluster.y - cluster.radius),
      maxX: Math.max(box.maxX, cluster.x + cluster.radius), maxY: Math.max(box.maxY, cluster.y + cluster.radius),
    }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const enclosingRadius = clusters.reduce((radius, cluster) => Math.max(radius,
      Math.hypot(cluster.x - centerX, cluster.y - centerY) + cluster.radius), 0);
    return { root, positions, clusters, centerX, centerY, enclosingRadius };
  });

  // Place the largest family centrally, with independent families and isolates
  // distributed around complete rings. Only translations change: every internal
  // edge and cluster keeps its validated geometry inside an enclosing disk.
  layouts.sort((a, b) => b.enclosingRadius - a.enclosingRadius || compareIds(a.root, b.root));
  const gap = 64;
  const fullCircle = Math.PI * 2;
  const result: ClusterLayoutResult = { ...empty, positions: [], clusters: [], extraEdgeCount: edges.length - selectedEdges };
  const place = (layout: typeof layouts[number], centerX: number, centerY: number) => {
    const offsetX = layouts.length === 1 ? 0 : centerX - layout.centerX;
    const offsetY = layouts.length === 1 ? 0 : centerY - layout.centerY;
    for (const node of layout.positions) result.positions.push({ ...node, x: node.x + offsetX, y: node.y + offsetY });
    for (const cluster of layout.clusters) result.clusters.push({ ...cluster, x: cluster.x + offsetX, y: cluster.y + offsetY });
  };
  place(layouts[0], 0, 0);
  let outerRadius = layouts[0].enclosingRadius;
  let next = 1;
  let ringIndex = 0;
  while (next < layouts.length) {
    const largestRadius = layouts[next].enclosingRadius;
    const ringRadius = outerRadius + gap + largestRadius;
    const ring: { layout: typeof layouts[number]; angularWidth: number }[] = [];
    let occupiedAngle = 0;
    while (next < layouts.length) {
      const layout = layouts[next];
      const angularWidth = 2 * Math.asin(Math.min(1, (layout.enclosingRadius + gap / 2) / ringRadius));
      if (ring.length > 0 && occupiedAngle + angularWidth > fullCircle + 1e-10) break;
      ring.push({ layout, angularWidth });
      occupiedAngle += angularWidth;
      next += 1;
    }
    // Equal extra angle fills 360 degrees even when the final ring is sparse.
    const angularGap = Math.max(0, (fullCircle - occupiedAngle) / ring.length);
    let angle = -Math.PI / 2 + (ringIndex % 2 === 0 ? 0 : Math.PI / ring.length);
    ring.forEach(({ layout, angularWidth }, index) => {
      place(layout, Math.cos(angle) * ringRadius, Math.sin(angle) * ringRadius);
      const following = ring[(index + 1) % ring.length];
      angle += angularWidth / 2 + following.angularWidth / 2 + angularGap;
    });
    outerRadius = ringRadius + largestRadius;
    ringIndex += 1;
  }
  result.positions.sort((a, b) => compareIds(a.id, b.id));
  result.clusters.sort((a, b) => compareIds(a.id, b.id));
  result.bounds = result.clusters.reduce((box, cluster) => ({
    minX: Math.min(box.minX, cluster.x - cluster.radius), minY: Math.min(box.minY, cluster.y - cluster.radius),
    maxX: Math.max(box.maxX, cluster.x + cluster.radius), maxY: Math.max(box.maxY, cluster.y + cluster.radius),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  return result;
}
