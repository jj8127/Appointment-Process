/** Geometry only. Numeric IDs are canonical per-component adapter indices. */
export type Point = { x: number; y: number };
export type CoreNode = { id: number; parent: number | null; depth: number; radius: number };
export type GraphCluster = Point & { id: number; radius: number; memberIds: number[] };

export const CLUSTER_GAP = 24;
export const BACKBONE_CLEARANCE = 10;
const COMPACTION_HUB_LIMIT = 180;
const LEAF_CLEARANCE = 6;
const TWO_PI = Math.PI * 2;

type Cluster = GraphCluster & {
  parent: number | null;
  leaves: number[];
  neighbors: number[];
  orbit: number;
  leafRadius: number;
};

export function closestPointOnSegment(point: Point, source: Point, target: Point): Point {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator > 0 ? Math.max(0, Math.min(1,
    ((point.x - source.x) * dx + (point.y - source.y) * dy) / denominator)) : 0;
  return { x: source.x + dx * t, y: source.y + dy * t };
}

function direction(a: Point, b: Point, salt: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const angle = salt * 2.399963229728653;
  return { x: distance > 0.00001 ? dx / distance : Math.cos(angle),
    y: distance > 0.00001 ? dy / distance : Math.sin(angle), distance };
}

function orientation(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) || Math.max(c.x, d.x) < Math.min(a.x, b.x)
    || Math.max(a.y, b.y) < Math.min(c.y, d.y) || Math.max(c.y, d.y) < Math.min(a.y, b.y)) return false;
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD <= 1e-8 && cdA * cdB <= 1e-8;
}

function edgesShareEndpoint(a: [Cluster, Cluster], b: [Cluster, Cluster]) {
  return a[0].id === b[0].id || a[0].id === b[1].id || a[1].id === b[0].id || a[1].id === b[1].id;
}

function diskClear(a: Cluster, b: Cluster) {
  const required = a.radius + b.radius + CLUSTER_GAP + 0.01;
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 >= required * required;
}

function edgeClear(source: Cluster, target: Cluster, disk: Cluster) {
  const nearest = closestPointOnSegment(disk, source, target);
  const required = disk.radius + BACKBONE_CLEARANCE + 0.01;
  return (nearest.x - disk.x) ** 2 + (nearest.y - disk.y) ** 2 >= required * required;
}

function clearanceExpansion(clusters: Cluster[], links: [Cluster, Cluster][]) {
  let expansion = 1;
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      const a = clusters[i];
      const b = clusters[j];
      expansion = Math.max(expansion, (a.radius + b.radius + CLUSTER_GAP + 0.1)
        / Math.max(0.00001, Math.hypot(a.x - b.x, a.y - b.y)));
    }
  }
  for (const [source, target] of links) {
    for (const disk of clusters) {
      if (disk.id === source.id || disk.id === target.id) continue;
      const nearest = closestPointOnSegment(disk, source, target);
      expansion = Math.max(expansion, (disk.radius + BACKBONE_CLEARANCE + 0.1)
        / Math.max(0.00001, Math.hypot(nearest.x - disk.x, nearest.y - disk.y)));
    }
  }
  return expansion;
}

function initializePlanarClusters(clusters: Cluster[], children: Map<number, number[]>) {
  const byId = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const weights = new Map<number, number>();
  for (let i = clusters.length - 1; i >= 0; i -= 1) {
    const cluster = clusters[i];
    const offspring = children.get(cluster.id)!.filter((id) => byId.has(id));
    weights.set(cluster.id, Math.max(cluster.radius * 2,
      offspring.reduce((sum, id) => sum + weights.get(id)!, 0)));
  }
  const sectors = new Map<number, [number, number]>([[0, [-Math.PI, Math.PI]]]);
  const angles = new Map<number, number>();
  const depths = new Map<number, number>([[0, 0]]);
  const levels: Cluster[][] = [[clusters[0]]];
  for (const cluster of clusters) {
    const [start, end] = sectors.get(cluster.id)!;
    angles.set(cluster.id, (start + end) / 2);
    const offspring = children.get(cluster.id)!.filter((id) => byId.has(id));
    if (!offspring.length) continue;
    const cap = cluster.id === 0 ? (offspring.length >= 4 ? Math.PI / 2 : Math.PI * 0.85) : end - start;
    const widths = new Map<number, number>();
    let remaining = [...offspring];
    let sweep = Math.min(end - start, cap * offspring.length);
    while (remaining.length) {
      const total = remaining.reduce((sum, id) => sum + weights.get(id)!, 0);
      const capped = remaining.filter((id) => sweep * weights.get(id)! / total > cap);
      if (!capped.length) {
        for (const id of remaining) widths.set(id, sweep * weights.get(id)! / total);
        break;
      }
      for (const id of capped) { widths.set(id, cap); sweep -= cap; }
      remaining = remaining.filter((id) => !widths.has(id));
    }
    let cursor = start;
    for (const id of offspring) {
      const width = widths.get(id)!;
      sectors.set(id, [cursor, cursor + width]);
      const depth = depths.get(cluster.id)! + 1;
      depths.set(id, depth);
      (levels[depth] ??= []).push(byId.get(id)!);
      cursor += width;
    }
  }
  const levelRadii = [0];
  for (let depth = 1; depth < levels.length; depth += 1) {
    const level = levels[depth];
    const previousMax = Math.max(...levels[depth - 1].map((cluster) => cluster.radius));
    const currentMax = Math.max(...level.map((cluster) => cluster.radius));
    let radius = levelRadii[depth - 1] + previousMax + currentMax + CLUSTER_GAP + 12;
    for (const cluster of level) {
      const delta = angles.get(cluster.id)! - angles.get(cluster.parent!)!;
      if (cluster.parent !== 0) radius = Math.max(radius, (levelRadii[depth - 1] + 1) / Math.cos(delta));
    }
    for (let i = 0; i < level.length; i += 1) {
      for (let j = i + 1; j < level.length; j += 1) {
        const a = level[i];
        const b = level[j];
        const chord = 2 * Math.abs(Math.sin((angles.get(a.id)! - angles.get(b.id)!) / 2));
        radius = Math.max(radius, (a.radius + b.radius + CLUSTER_GAP + 12) / chord);
      }
    }
    levelRadii.push(radius);
    for (const cluster of level) {
      const angle = angles.get(cluster.id)!;
      cluster.x = Math.cos(angle) * radius;
      cluster.y = Math.sin(angle) * radius;
    }
  }
}

function validSingleMove(moving: Cluster, clusters: Cluster[], links: [Cluster, Cluster][], incident: [Cluster, Cluster][]) {
  for (const other of clusters) if (other.id !== moving.id && !diskClear(moving, other)) return false;
  for (const [source, target] of links) {
    if (source.id !== moving.id && target.id !== moving.id && !edgeClear(source, target, moving)) return false;
  }
  for (const edge of incident) {
    for (const disk of clusters) {
      if (disk.id !== edge[0].id && disk.id !== edge[1].id && !edgeClear(edge[0], edge[1], disk)) return false;
    }
    for (const other of links) {
      if (!edgesShareEndpoint(edge, other) && segmentsIntersect(edge[0], edge[1], other[0], other[1])) return false;
    }
  }
  return true;
}

function validRigidMove(moved: Set<number>, clusters: Cluster[], links: [Cluster, Cluster][]) {
  for (let i = 0; i < clusters.length; i += 1) {
    for (let j = i + 1; j < clusters.length; j += 1) {
      const a = clusters[i];
      const b = clusters[j];
      if (moved.has(a.id) !== moved.has(b.id) && !diskClear(a, b)) return false;
    }
  }
  for (const [source, target] of links) {
    const sourceMoved = moved.has(source.id);
    const targetMoved = moved.has(target.id);
    for (const disk of clusters) {
      if (disk.id === source.id || disk.id === target.id) continue;
      if (sourceMoved === targetMoved && sourceMoved === moved.has(disk.id)) continue;
      if (!edgeClear(source, target, disk)) return false;
    }
  }
  for (let i = 0; i < links.length; i += 1) {
    const edge = links[i];
    for (let j = i + 1; j < links.length; j += 1) {
      const other = links[j];
      if (edgesShareEndpoint(edge, other)) continue;
      const states = [moved.has(edge[0].id), moved.has(edge[1].id), moved.has(other[0].id), moved.has(other[1].id)];
      if (states.every((state) => state === states[0])) continue;
      if (segmentsIntersect(edge[0], edge[1], other[0], other[1])) return false;
    }
  }
  return true;
}

/** Worker preparation. Every accepted move preserves disks, line clearance and planarity. */
function settleClusters(clusters: Cluster[], links: [Cluster, Cluster][]) {
  const byId = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const expansion = clearanceExpansion(clusters, links);
  if (expansion > 100) throw new Error('Planar cluster seed needs excessive clearance');
  for (const cluster of clusters) { cluster.x *= expansion; cluster.y *= expansion; }
  for (let i = 0; i < links.length; i += 1) {
    for (let j = i + 1; j < links.length; j += 1) {
      if (!edgesShareEndpoint(links[i], links[j]) && segmentsIntersect(...links[i], ...links[j])) {
        throw new Error('Planar cluster seed contains an intersection');
      }
    }
  }
  const incident = new Map(clusters.map((cluster) => [cluster.id, links.filter((edge) => edge[0].id === cluster.id || edge[1].id === cluster.id)]));
  const subtrees = new Map<number, Cluster[]>();
  for (let i = clusters.length - 1; i >= 0; i -= 1) {
    const cluster = clusters[i];
    subtrees.set(cluster.id, [cluster, ...clusters.filter((other) => other.parent === cluster.id).flatMap((child) => subtrees.get(child.id)!)]);
  }
  for (let iteration = 0; iteration < 260; iteration += 1) {
    // Rigid subtree translation shortens long radial bands without squeezing a
    // whole descendant tree into an exponentially growing enclosing circle.
    if (iteration % 3 === 0) {
      for (const cluster of [...clusters].reverse()) {
        if (cluster.id === 0) continue;
        const members = subtrees.get(cluster.id)!;
        if (members.length < 2) continue;
        const parent = byId.get(cluster.parent!)!;
        const vector = direction(cluster, parent, cluster.id);
        const desired = cluster.radius + parent.radius + CLUSTER_GAP + 25;
        const distance = Math.min(70, Math.max(0, (vector.distance - desired) * 0.2));
        if (distance < 0.05) continue;
        const moved = new Set(members.map((member) => member.id));
        const before = members.map((member) => ({ x: member.x, y: member.y }));
        for (const fraction of [1, 0.5, 0.25, 0.1]) {
          members.forEach((member, index) => {
            member.x = before[index].x + vector.x * distance * fraction;
            member.y = before[index].y + vector.y * distance * fraction;
          });
          if (validRigidMove(moved, clusters, links)) break;
          members.forEach((member, index) => { member.x = before[index].x; member.y = before[index].y; });
        }
      }
    }
    const ordered = iteration % 2 === 0 ? clusters : [...clusters].reverse();
    for (const cluster of ordered) {
      if (cluster.id === 0) continue;
      let dx = -cluster.x * 0.0015;
      let dy = -cluster.y * 0.0015;
      for (const id of cluster.neighbors) {
        const neighbor = byId.get(id)!;
        const vector = direction(cluster, neighbor, id);
        const desired = cluster.radius + neighbor.radius + CLUSTER_GAP + 25;
        dx += vector.x * (vector.distance - desired) * 0.1 / cluster.neighbors.length;
        dy += vector.y * (vector.distance - desired) * 0.1 / cluster.neighbors.length;
      }
      const length = Math.hypot(dx, dy);
      if (length < 0.01) continue;
      const step = Math.min(1, 40 / length);
      const oldX = cluster.x;
      const oldY = cluster.y;
      let accepted = false;
      for (const angle of [0, 0.45, -0.45, 0.9, -0.9]) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        for (const fraction of [1, 0.5, 0.15]) {
          cluster.x = oldX + (dx * cos - dy * sin) * step * fraction;
          cluster.y = oldY + (dx * sin + dy * cos) * step * fraction;
          if (validSingleMove(cluster, clusters, links, incident.get(cluster.id)!)) { accepted = true; break; }
        }
        if (accepted) break;
      }
      if (!accepted) { cluster.x = oldX; cluster.y = oldY; }
    }
  }
}
/** Large forests use one analytical pass instead of iterative compaction.
 * Nested horizontal subtree intervals make every depth band planar. Its height
 * is enlarged analytically until straight links clear endpoint-level disks.
 * Width is additive in terminal hub spans, never recursive subtree disk radii.
 */
function initializeTidyClusters(clusters: Cluster[]) {
  const byId = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const children = new Map(clusters.map((cluster) => [cluster.id, [] as Cluster[]]));
  for (const cluster of clusters) if (cluster.parent !== null) children.get(cluster.parent)!.push(cluster);
  const spans = new Map<number, number>();
  for (let i = clusters.length - 1; i >= 0; i -= 1) {
    const cluster = clusters[i];
    spans.set(cluster.id, Math.max(cluster.radius * 2 + CLUSTER_GAP + 1,
      children.get(cluster.id)!.reduce((sum, child) => sum + spans.get(child.id)!, 0)));
  }
  const left = new Map<number, number>([[0, -spans.get(0)! / 2]]);
  const depths = new Map<number, number>([[0, 0]]);
  const levels: Cluster[][] = [];
  for (const cluster of clusters) {
    cluster.x = left.get(cluster.id)! + spans.get(cluster.id)! / 2;
    const depth = depths.get(cluster.id)!;
    (levels[depth] ??= []).push(cluster);
    const offspring = children.get(cluster.id)!;
    const total = offspring.reduce((sum, child) => sum + spans.get(child.id)!, 0);
    let cursor = cluster.x - total / 2;
    for (const child of offspring) {
      left.set(child.id, cursor);
      depths.set(child.id, depth + 1);
      cursor += spans.get(child.id)!;
    }
  }
  let y = 0;
  for (let depth = 0; depth < levels.length; depth += 1) {
    if (depth > 0) {
      const previous = levels[depth - 1];
      const current = levels[depth];
      let height = Math.max(...previous.map((cluster) => cluster.radius))
        + Math.max(...current.map((cluster) => cluster.radius)) + CLUSTER_GAP + 1;
      for (const target of current) {
        const source = byId.get(target.parent!)!;
        const horizontal = Math.abs(target.x - source.x);
        for (const [endpoint, peers] of [[source, previous], [target, current]] as const) {
          for (const disk of peers) {
            if (disk.id === endpoint.id) continue;
            const delta = Math.abs(disk.x - endpoint.x);
            const clearance = disk.radius + BACKBONE_CLEARANCE + 0.1;
            height = Math.max(height, horizontal * clearance / Math.sqrt(delta * delta - clearance * clearance));
          }
        }
      }
      y += height;
    }
    for (const cluster of levels[depth]) cluster.y = y;
  }
}

function chooseLeafAngles(cluster: Cluster, byId: Map<number, Cluster>): number[] | null {
  const selected: number[] = [];
  const connectorAngles = cluster.neighbors.map((id) => {
    const neighbor = byId.get(id)!;
    return Math.atan2(neighbor.y - cluster.y, neighbor.x - cluster.x);
  });
  if (cluster.leaves.length > 24) {
    // Sufficient uniformly separated slots keep a very large star O(L*degree)
    // rather than the small-star greedy O(L²) selection below.
    const slots = cluster.leaves.length + connectorAngles.length * 3;
    const available: number[] = [];
    for (let index = 0; index < slots; index += 1) {
      const angle = TWO_PI * index / slots;
      const clear = connectorAngles.every((connector) => {
        const delta = Math.abs(Math.atan2(Math.sin(angle - connector), Math.cos(angle - connector)));
        return delta >= Math.PI / 2 || Math.sin(delta) * cluster.orbit >= cluster.leafRadius + LEAF_CLEARANCE + 0.01;
      });
      if (clear) available.push(angle);
    }
    if (available.length < cluster.leaves.length) return null;
    return cluster.leaves.map((_, index) => available[Math.floor(index * available.length / cluster.leaves.length)]);
  }
  for (let leaf = 0; leaf < cluster.leaves.length; leaf += 1) {
    let bestAngle = 0;
    let bestScore = -Infinity;
    for (let step = 0; step < 360; step += 1) {
      const angle = (step / 360) * TWO_PI - Math.PI;
      let clearance = Infinity;
      for (const connector of connectorAngles) {
        const delta = Math.abs(Math.atan2(Math.sin(angle - connector), Math.cos(angle - connector)));
        // A connector is a ray: points behind the hub do not intersect it.
        const distance = delta >= Math.PI / 2 ? cluster.orbit : Math.sin(delta) * cluster.orbit;
        clearance = Math.min(clearance, distance / (cluster.leafRadius + LEAF_CLEARANCE));
      }
      for (const previous of selected) {
        const distance = Math.hypot(Math.cos(angle) - Math.cos(previous), Math.sin(angle) - Math.sin(previous)) * cluster.orbit;
        clearance = Math.min(clearance, distance / (2 * cluster.leafRadius + LEAF_CLEARANCE));
      }
      if (clearance > bestScore) { bestScore = clearance; bestAngle = angle; }
    }
    if (bestScore < 1.001) return null;
    selected.push(bestAngle);
  }
  return selected;
}

/** Each disk encloses one actual parent and only that parent's terminal children. */
export function buildClusterCore(sourceNodes: CoreNode[], allowCompaction = true) {
  const children = new Map(sourceNodes.map((node) => [node.id, [] as number[]]));
  const radii = new Map(sourceNodes.map((node) => [node.id, node.radius]));
  for (const node of sourceNodes) if (node.parent !== null) children.get(node.parent)!.push(node.id);
  for (const siblings of children.values()) siblings.sort((a, b) => a - b);
  const nodes = sourceNodes.map((node) => ({ ...node, directCount: children.get(node.id)!.length }));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const hubs = nodes.filter((node) => node.id === 0 || node.directCount > 0).sort((a, b) => a.depth - b.depth || a.id - b.id);
  const clusters: Cluster[] = hubs.map((node) => {
    const leaves = children.get(node.id)!.filter((id) => nodeById.get(id)!.directCount === 0);
    const neighbors = children.get(node.id)!.filter((id) => nodeById.get(id)!.directCount > 0);
    if (node.parent !== null) neighbors.push(node.parent);
    const leafRadius = Math.max(1, ...leaves.map((id) => radii.get(id)!));
    const slots = Math.max(2, leaves.length + neighbors.length * (leaves.length > 24 ? 3 : 1));
    const orbit = leaves.length ? Math.max(radii.get(node.id)! + leafRadius + 16,
      (2 * leafRadius + LEAF_CLEARANCE) / (2 * Math.sin(Math.PI / slots))) : 0;
    return { id: node.id, parent: node.parent, leaves, neighbors, orbit, leafRadius,
      radius: leaves.length ? orbit + leafRadius + 10 : radii.get(node.id)! + 10,
      memberIds: [node.id, ...leaves], x: 0, y: 0 };
  });
  const byId = new Map(clusters.map((cluster) => [cluster.id, cluster]));
  const links = clusters.filter((cluster) => cluster.parent !== null)
    .map((cluster) => [byId.get(cluster.parent!)!, cluster] as [Cluster, Cluster]);
  let useTidyLayout = !allowCompaction || clusters.length > COMPACTION_HUB_LIMIT;
  if (!useTidyLayout) initializePlanarClusters(clusters, children);

  let leafAngles = new Map<number, number[]>();
  for (let pass = 0; pass < 6; pass += 1) {
    if (useTidyLayout) initializeTidyClusters(clusters);
    else {
      try {
        settleClusters(clusters, links);
      } catch {
        // A pathological radial seed can use the analytical planar layout too;
        // it must never remove data or prevent the remaining forest rendering.
        useTidyLayout = true;
        initializeTidyClusters(clusters);
      }
    }
    leafAngles = new Map();
    let expanded = false;
    for (const cluster of clusters) {
      const angles = chooseLeafAngles(cluster, byId);
      if (angles) leafAngles.set(cluster.id, angles);
      else {
        cluster.orbit = cluster.orbit * 1.18 + 4;
        cluster.radius = cluster.orbit + cluster.leafRadius + 10;
        expanded = true;
      }
    }
    if (!expanded) break;
  }
  if (leafAngles.size !== clusters.length) throw new Error('Cluster leaf connector clearance did not converge');
  const positions = new Map<number, Point>();
  for (const cluster of clusters) {
    positions.set(cluster.id, { x: cluster.x, y: cluster.y });
    cluster.leaves.forEach((id, index) => {
      const angle = leafAngles.get(cluster.id)![index];
      positions.set(id, { x: cluster.x + Math.cos(angle) * cluster.orbit,
        y: cluster.y + Math.sin(angle) * cluster.orbit });
    });
  }
  return { positions, clusters: clusters.map(({ id, x, y, radius, memberIds }) => ({ id, x, y, radius, memberIds })) };
}
