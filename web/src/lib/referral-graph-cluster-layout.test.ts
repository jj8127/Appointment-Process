import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReferralClusterLayout } from './referral-graph-cluster-layout.ts';

type InputNode = { id: string; radius: number };
type InputEdge = { source: string; target: string };
type InputGraph = { nodes: InputNode[]; edges: InputEdge[] };
type Point = { x: number; y: number };
type Layout = ReturnType<typeof buildReferralClusterLayout>;

const EPSILON = 1e-6;
const NODE_GAP = 6;
const CLUSTER_GAP = 24;

function node(id: string, radius = 8): InputNode {
  return { id, radius };
}

function edge(source: string, target: string): InputEdge {
  return { source, target };
}

function codepointCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function signedDistanceToLine(point: Point, start: Point, end: Point) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  assert.ok(length > EPSILON, 'an edge must have distinct positioned endpoints');
  return ((end.x - start.x) * (point.y - start.y)
    - (end.y - start.y) * (point.x - start.x)) / length;
}

function pointOnSegment(point: Point, start: Point, end: Point) {
  return Math.abs(signedDistanceToLine(point, start, end)) <= EPSILON
    && point.x >= Math.min(start.x, end.x) - EPSILON
    && point.x <= Math.max(start.x, end.x) + EPSILON
    && point.y >= Math.min(start.y, end.y) - EPSILON
    && point.y <= Math.max(start.y, end.y) + EPSILON;
}

function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  assert.ok(lengthSquared > EPSILON * EPSILON);
  const fraction = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - start.x - fraction * dx, point.y - start.y - fraction * dy);
}

// Endpoint contact and collinear overlap matter as much as proper crossings.
function segmentsMeet(a: Point, b: Point, c: Point, d: Point) {
  if (pointOnSegment(c, a, b) || pointOnSegment(d, a, b)
    || pointOnSegment(a, c, d) || pointOnSegment(b, c, d)) return true;
  const abC = signedDistanceToLine(c, a, b);
  const abD = signedDistanceToLine(d, a, b);
  const cdA = signedDistanceToLine(a, c, d);
  const cdB = signedDistanceToLine(b, c, d);
  return ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON))
    && ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON));
}

function assertGeometry(layout: Layout, expectedIds: string[]) {
  const { positions, clusters, bounds } = layout;
  assert.deepEqual(
    positions.map(({ id }) => id).sort(codepointCompare),
    [...expectedIds].sort(codepointCompare),
    'every normalized node must have exactly one position',
  );
  for (const value of Object.values(bounds)) assert.ok(Number.isFinite(value), 'bounds must be finite');
  assert.ok(bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY, 'bounds must be ordered');
  assert.ok(Number.isInteger(layout.extraEdgeCount) && layout.extraEdgeCount >= 0);

  const positionsById = new Map(positions.map((position) => [position.id, position]));
  const membership: string[] = [];
  assert.equal(new Set(clusters.map(({ id }) => id)).size, clusters.length, 'cluster IDs must be unique');
  for (const cluster of clusters) {
    assert.ok(Number.isFinite(cluster.x) && Number.isFinite(cluster.y));
    assert.ok(Number.isFinite(cluster.radius) && cluster.radius > 0, 'cluster radius must be finite and positive');
    assert.ok(cluster.memberIds.length > 0, 'empty clusters must not be emitted');
    membership.push(...cluster.memberIds);
    for (const id of cluster.memberIds) {
      const member = positionsById.get(id);
      assert.ok(member, `cluster references unknown member ${id}`);
      assert.ok(
        Math.hypot(member.x - cluster.x, member.y - cluster.y) + member.radius <= cluster.radius + EPSILON,
        `cluster disk must contain the entire member circle ${id}`,
      );
    }
  }
  assert.deepEqual(membership.sort(codepointCompare), [...expectedIds].sort(codepointCompare),
    'every normalized node must belong to exactly one cluster');

  for (let leftIndex = 0; leftIndex < positions.length; leftIndex += 1) {
    const left = positions[leftIndex];
    assert.ok(Number.isFinite(left.x) && Number.isFinite(left.y), `position must be finite for ${left.id}`);
    assert.ok(Number.isFinite(left.radius) && left.radius > 0, `radius must be finite and positive for ${left.id}`);
    assert.ok(left.x - left.radius >= bounds.minX - EPSILON && left.x + left.radius <= bounds.maxX + EPSILON,
      `horizontal bounds must contain ${left.id}`);
    assert.ok(left.y - left.radius >= bounds.minY - EPSILON && left.y + left.radius <= bounds.maxY + EPSILON,
      `vertical bounds must contain ${left.id}`);
    for (let rightIndex = leftIndex + 1; rightIndex < positions.length; rightIndex += 1) {
      const right = positions[rightIndex];
      const gap = Math.hypot(left.x - right.x, left.y - right.y) - left.radius - right.radius;
      assert.ok(gap >= NODE_GAP - EPSILON,
        `node circles ${left.id} and ${right.id} need ${NODE_GAP}px clearance; got ${gap}`);
    }
  }
  for (let leftIndex = 0; leftIndex < clusters.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < clusters.length; rightIndex += 1) {
      const left = clusters[leftIndex];
      const right = clusters[rightIndex];
      const gap = Math.hypot(left.x - right.x, left.y - right.y) - left.radius - right.radius;
      assert.ok(gap >= CLUSTER_GAP - EPSILON,
        `cluster disks ${left.id} and ${right.id} need ${CLUSTER_GAP}px clearance; got ${gap}`);
    }
  }
}

function assertForestEdges(layout: Layout, edges: InputEdge[]) {
  assert.equal(layout.extraEdgeCount, 0, 'every valid forest edge must be retained');
  const positionsById = new Map(layout.positions.map((position) => [position.id, position]));
  for (let leftIndex = 0; leftIndex < edges.length; leftIndex += 1) {
    const left = edges[leftIndex];
    const a = positionsById.get(left.source);
    const b = positionsById.get(left.target);
    assert.ok(a && b, 'every forest edge must have positioned endpoints');
    for (const position of layout.positions) {
      if (position.id === left.source || position.id === left.target) continue;
      const clearance = pointToSegmentDistance(position, a, b) - position.radius;
      assert.ok(clearance >= NODE_GAP - EPSILON,
        `edge ${left.source}->${left.target} needs ${NODE_GAP}px clearance from unrelated node ${position.id}; got ${clearance}`);
    }
    for (let rightIndex = leftIndex + 1; rightIndex < edges.length; rightIndex += 1) {
      const right = edges[rightIndex];
      if (left.source === right.source || left.source === right.target
        || left.target === right.source || left.target === right.target) continue;
      const c = positionsById.get(right.source);
      const d = positionsById.get(right.target);
      assert.ok(c && d);
      assert.equal(segmentsMeet(a, b, c, d), false,
        `disjoint edges ${left.source}->${left.target} and ${right.source}->${right.target} must not cross, touch, or overlap`);
    }
  }
}

function assertForest(graph: InputGraph) {
  const layout = buildReferralClusterLayout(graph);
  assertGeometry(layout, graph.nodes.map(({ id }) => id));
  assertForestEdges(layout, graph.edges);
  for (const input of graph.nodes) {
    assert.equal(layout.positions.find(({ id }) => id === input.id)?.radius, input.radius,
      `valid radius must be preserved for ${input.id}`);
  }
  return layout;
}

function canonicalLayout(layout: Layout) {
  return {
    ...layout,
    positions: [...layout.positions].sort((left, right) => codepointCompare(left.id, right.id)),
    clusters: layout.clusters.map((cluster) => ({
      ...cluster,
      memberIds: [...cluster.memberIds].sort(codepointCompare),
    })).sort((left, right) => codepointCompare(left.id, right.id)),
  };
}

function reverseInput(graph: InputGraph): InputGraph {
  return {
    nodes: [...graph.nodes].reverse().map((input) => ({ ...input })),
    edges: [...graph.edges].reverse().map((input) => ({ ...input })),
  };
}

function makeHubTree(hubCount: number): InputGraph {
  const nodes = [node('root', 24)];
  const edges: InputEdge[] = [];
  for (let index = 0; index < 6; index += 1) {
    const id = `root-terminal-${index}`;
    nodes.push(node(id, 6 + index));
    edges.push(edge('root', id));
  }
  for (let hubIndex = 0; hubIndex < hubCount; hubIndex += 1) {
    const hubId = `hub-${hubIndex}`;
    nodes.push(node(hubId, 14 + hubIndex * 8));
    edges.push(edge('root', hubId));
    const leafCount = [1, 5, 17][hubIndex];
    for (let leafIndex = 0; leafIndex < leafCount; leafIndex += 1) {
      const id = `${hubId}-terminal-${leafIndex}`;
      nodes.push(node(id, 7 + (leafIndex % 4) * 3));
      edges.push(edge(hubId, id));
    }
  }
  return { nodes, edges };
}

// Generated topology only: no production IDs, records, or fixture-derived edges.
function makeSynthetic334(): InputGraph {
  const parentIds = Array.from({ length: 117 }, (_, index) => `synthetic-parent-${String(index).padStart(3, '0')}`);
  const nodes = parentIds.map((id, index) => node(id, 11 + (index % 6) * 3));
  const edges = parentIds.slice(1).map((id, index) => edge(parentIds[Math.floor(index / 3)], id));
  for (let index = 0; index < 217; index += 1) {
    const id = `synthetic-terminal-${String(index).padStart(3, '0')}`;
    const parentIndex = index < parentIds.length ? index : ((index - parentIds.length) * 43) % parentIds.length;
    nodes.push(node(id, 6 + (index % 5) * 2));
    edges.push(edge(parentIds[parentIndex], id));
  }
  return { nodes, edges };
}

function prefixGraph(graph: InputGraph, prefix: string): InputGraph {
  return {
    nodes: graph.nodes.map((input) => ({ ...input, id: `${prefix}${input.id}` })),
    edges: graph.edges.map((input) => edge(`${prefix}${input.source}`, `${prefix}${input.target}`)),
  };
}

function componentCenter(layout: Layout, ids: Set<string>): Point {
  const clusters = layout.clusters.filter((cluster) => ids.has(cluster.id));
  assert.ok(clusters.length > 0);
  const minX = Math.min(...clusters.map((cluster) => cluster.x - cluster.radius));
  const maxX = Math.max(...clusters.map((cluster) => cluster.x + cluster.radius));
  const minY = Math.min(...clusters.map((cluster) => cluster.y - cluster.radius));
  const maxY = Math.max(...clusters.map((cluster) => cluster.y + cluster.radius));
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function assertSurrounds(points: Point[], center: Point) {
  // A shelf below/right of the main genealogy cannot satisfy this check.
  const angles = points.map((point) => (Math.atan2(point.y - center.y, point.x - center.x) + Math.PI * 2) % (Math.PI * 2))
    .sort((left, right) => left - right);
  assert.ok(angles.length >= 4);
  const gaps = angles.map((angle, index) => (index + 1 < angles.length ? angles[index + 1] : angles[0] + Math.PI * 2) - angle);
  assert.ok(Math.max(...gaps) < Math.PI, 'independent components must surround the main genealogy, not occupy one half-plane');
  assert.ok(points.some((point) => point.x < center.x - EPSILON));
  assert.ok(points.some((point) => point.x > center.x + EPSILON));
  assert.ok(points.some((point) => point.y < center.y - EPSILON));
  assert.ok(points.some((point) => point.y > center.y + EPSILON));
}

test('mixed independent genealogies and isolates surround the main component without disturbing its internal geometry', () => {
  const main = prefixGraph(makeHubTree(3), 'main-');
  const satellites: InputGraph[] = Array.from({ length: 8 }, (_, index) => {
    const root = `satellite-${index}`;
    const leaves = Array.from({ length: index + 2 }, (_, leafIndex) => node(`${root}-leaf-${leafIndex}`, 5 + leafIndex % 4));
    return { nodes: [node(root, 11 + index), ...leaves], edges: leaves.map(({ id }) => edge(root, id)) };
  });
  const isolates = Array.from({ length: 72 }, (_, index) => node(`radial-isolate-${String(index).padStart(2, '0')}`, 5 + index % 4));
  const graph = { nodes: [...main.nodes, ...satellites.flatMap((part) => part.nodes), ...isolates], edges: [...main.edges, ...satellites.flatMap((part) => part.edges)] };
  const layout = assertForest(graph);
  const mainCenter = componentCenter(layout, new Set(main.nodes.map(({ id }) => id)));
  const satelliteCenters = satellites.map((part) => componentCenter(layout, new Set(part.nodes.map(({ id }) => id))));
  const isolatePositions = layout.positions.filter(({ id }) => id.startsWith('radial-isolate-'));
  assertSurrounds([...satelliteCenters, ...isolatePositions], mainCenter);
  // Isolates share the circular packing with trees rather than accumulating in
  // an extra shelf. Trees alone must also surround the center when no isolates exist.
  const treesOnly = assertForest({ nodes: [...main.nodes, ...satellites.flatMap((part) => part.nodes)], edges: graph.edges });
  assertSurrounds(satellites.map((part) => componentCenter(treesOnly, new Set(part.nodes.map(({ id }) => id)))),
    componentCenter(treesOnly, new Set(main.nodes.map(({ id }) => id))));
  assert.deepEqual(canonicalLayout(layout), canonicalLayout(buildReferralClusterLayout(reverseInput(graph))),
    'radial component packing must not depend on input record order');

  const single = buildReferralClusterLayout(main);
  const positions = new Map(layout.positions.map((position) => [position.id, position]));
  const reference = single.positions[0];
  const translatedReference = positions.get(reference.id)!;
  for (const position of single.positions) {
    const translated = positions.get(position.id)!;
    assert.ok(Math.abs((position.x - reference.x) - (translated.x - translatedReference.x)) <= EPSILON);
    assert.ok(Math.abs((position.y - reference.y) - (translated.y - translatedReference.y)) <= EPSILON,
      'adding disconnected components must preserve the main genealogy internal coordinates up to translation');
  }
});

test('equal-radius isolates form a few concentric rings instead of a rectangular shelf', () => {
  const graph = { nodes: Array.from({ length: 49 }, (_, index) => node(`ring-only-${String(index).padStart(2, '0')}`, 8)), edges: [] };
  const layout = assertForest(graph);
  const center = layout.positions.find(({ id }) => id === 'ring-only-00')!;
  const surrounding = layout.positions.filter(({ id }) => id !== center.id);
  assertSurrounds(surrounding, center);
  const rings = new Map<number, Point[]>();
  for (const point of surrounding) {
    const distance = Math.round(Math.hypot(point.x - center.x, point.y - center.y) * 1e5) / 1e5;
    const members = rings.get(distance) ?? [];
    members.push(point); rings.set(distance, members);
  }
  assert.ok(rings.size >= 2 && rings.size <= 6,
    `49 equal-radius isolates should share a small number of radial bands, not grid diagonals; got ${rings.size}`);
  for (const points of rings.values()) {
    assert.ok(points.length >= 4, 'each ring in this balanced fixture should occupy several directions');
    assertSurrounds(points, center);
  }
  assert.deepEqual(canonicalLayout(layout), canonicalLayout(buildReferralClusterLayout(reverseInput(graph))));
});

test('edge-contact assertions detect crossings, endpoint touches and collinear overlaps', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  assert.equal(segmentsMeet(a, b, { x: 5, y: -5 }, { x: 5, y: 5 }), true);
  assert.equal(segmentsMeet(a, b, { x: 5, y: 0 }, { x: 5, y: 5 }), true);
  assert.equal(segmentsMeet(a, b, { x: 10, y: 0 }, { x: 12, y: 3 }), true);
  assert.equal(segmentsMeet(a, b, { x: 3, y: 0 }, { x: 15, y: 0 }), true);
  assert.equal(segmentsMeet(a, b, { x: 11, y: 0 }, { x: 15, y: 0 }), false);
  assert.equal(segmentsMeet(a, b, { x: 0, y: 1 }, { x: 10, y: 1 }), false);
});

test('empty graph returns finite empty geometry', () => {
  const layout = assertForest({ nodes: [], edges: [] });
  assert.deepEqual(layout.positions, []);
  assert.deepEqual(layout.clusters, []);
});

test('a single node keeps its radius and has exactly one containing cluster', () => {
  const layout = assertForest({ nodes: [node('single', 37)], edges: [] });
  assert.equal(layout.clusters.length, 1);
  assert.deepEqual(layout.clusters[0].memberIds, ['single']);
});

test('a disconnected forest and isolates retain every node in separated clusters', () => {
  const graph: InputGraph = {
    nodes: [node('a', 18), node('b', 7), node('c', 21), node('d', 10), node('e', 13), node('f', 8),
      ...Array.from({ length: 12 }, (_, index) => node(`isolate-${index}`, 4 + index))],
    edges: [edge('a', 'b'), edge('c', 'd'), edge('c', 'e'), edge('e', 'f')],
  };
  const layout = assertForest(graph);
  for (const isolate of graph.nodes.filter(({ id }) => id.startsWith('isolate-'))) {
    assert.ok(layout.clusters.some(({ memberIds }) => memberIds.length === 1 && memberIds[0] === isolate.id));
  }
});

test('a star with 80 terminal children preserves one parent cluster and varied node radii', () => {
  const leaves = Array.from({ length: 80 }, (_, index) => node(`terminal-${index}`, 4 + (index % 8) * 3));
  const layout = assertForest({
    nodes: [node('parent', 32), ...leaves],
    edges: leaves.map(({ id }) => edge('parent', id)),
  });
  assert.equal(layout.clusters.length, 1);
  assert.equal(layout.clusters[0].memberIds.length, 81);
});

test('a 128-node chain has no edge contact or compressed neighboring cluster disks', () => {
  const nodes = Array.from({ length: 128 }, (_, index) => node(`chain-${String(index).padStart(3, '0')}`, 6 + index % 11));
  const layout = assertForest({
    nodes,
    edges: nodes.slice(1).map(({ id }, index) => edge(nodes[index].id, id)),
  });
  assert.equal(layout.clusters.length, 127);
});

for (const hubCount of [1, 2, 3]) {
  test(`a root with ${hubCount} child hubs separates parent spokes and terminal child clusters`, () => {
    const graph = makeHubTree(hubCount);
    const layout = assertForest(graph);
    assert.equal(layout.clusters.length, hubCount + 1);
    for (const parent of graph.nodes.filter(({ id }) => id === 'root' || /^hub-\d$/.test(id))) {
      const terminalIds = graph.edges.filter(({ source, target }) => source === parent.id && target.includes('terminal'))
        .map(({ target }) => target);
      const cluster = layout.clusters.find(({ memberIds }) => memberIds.includes(parent.id));
      assert.ok(cluster);
      assert.deepEqual([...cluster.memberIds].sort(codepointCompare), [parent.id, ...terminalIds].sort(codepointCompare));
    }
  });
}

test('invalid radii normalize safely while positive radii respect supported bounds', () => {
  const cases = [
    ['nan', Number.NaN, 8], ['infinity', Number.POSITIVE_INFINITY, 8],
    ['negative-infinity', Number.NEGATIVE_INFINITY, 8], ['negative', -4, 8], ['zero', 0, 8],
    ['small', 0.25, 1], ['minimum', 1, 1], ['fractional', 12.5, 12.5],
    ['maximum', 256, 256], ['oversize', 1000, 256],
  ] as const;
  const layout = buildReferralClusterLayout({ nodes: cases.map(([id, radius]) => node(id, radius)), edges: [] });
  assertGeometry(layout, cases.map(([id]) => id));
  for (const [id, , expected] of cases) assert.equal(layout.positions.find((position) => position.id === id)?.radius, expected);
});

test('blank IDs and missing endpoints are ignored while duplicate valid records are normalized', () => {
  const graph: InputGraph = {
    nodes: [node('valid', 12), node('valid', 22), node('child', 6), node(''), node(' \t\n')],
    edges: [edge('valid', 'child'), edge('valid', 'child'), edge('missing', 'child'), edge('valid', 'missing'),
      edge('', 'valid'), edge('valid', ' \t\n')],
  };
  const layout = buildReferralClusterLayout(graph);
  assertGeometry(layout, ['valid', 'child']);
  assertForestEdges(layout, [edge('valid', 'child')]);
  assert.deepEqual(canonicalLayout(layout), canonicalLayout(buildReferralClusterLayout(reverseInput(graph))));
});

test('a unique valid self-loop is counted once as an extra edge', () => {
  const layout = buildReferralClusterLayout({
    nodes: [node('self', 14)],
    edges: [edge('self', 'self'), edge('self', 'self'), edge('missing', 'missing')],
  });
  assertGeometry(layout, ['self']);
  assert.equal(layout.extraEdgeCount, 1);
});

test('a directed cycle is safely reduced to a forest and reports its one excluded edge', () => {
  const graph: InputGraph = {
    nodes: [node('a'), node('b'), node('c')],
    edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
  };
  const layout = buildReferralClusterLayout(graph);
  assertGeometry(layout, graph.nodes.map(({ id }) => id));
  assert.equal(layout.extraEdgeCount, 1);
  assert.deepEqual(canonicalLayout(layout), canonicalLayout(buildReferralClusterLayout(reverseInput(graph))));
});

test('multiparent edges are counted without losing nodes or depending on input order', () => {
  const graph: InputGraph = {
    nodes: [node('a', 20), node('b', 10), node('c', 12), node('d', 6)],
    edges: [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd'), edge('c', 'd')],
  };
  const layout = buildReferralClusterLayout(graph);
  assertGeometry(layout, graph.nodes.map(({ id }) => id));
  assert.equal(layout.extraEdgeCount, 1);
  assert.deepEqual(canonicalLayout(layout), canonicalLayout(buildReferralClusterLayout(reverseInput(graph))));
});

test('opaque string IDs retain whitespace and codepoint identity under reversed input', () => {
  const ids = ['root', '1', '01', '10', '2', 'A', 'a', ' a ', '__proto__', 'constructor', '한', 'é', 'e\u0301', '😀'];
  const graph: InputGraph = {
    nodes: ids.map((id, index) => node(id, 5 + index)),
    edges: ids.slice(1).map((id) => edge('root', id)),
  };
  const before = structuredClone(graph);
  for (const input of [...graph.nodes, ...graph.edges]) Object.freeze(input);
  Object.freeze(graph.nodes);
  Object.freeze(graph.edges);
  Object.freeze(graph);
  const layout = assertForest(graph);
  assert.deepEqual(graph, before, 'layout must not mutate caller-owned node or edge records');
  assert.deepEqual(canonicalLayout(layout), canonicalLayout(buildReferralClusterLayout(reverseInput(graph))));
});

test('synthetic 334-node tree keeps 117 parent clusters and 217 terminal children without geometric collisions', () => {
  const graph = makeSynthetic334();
  assert.equal(graph.nodes.length, 334);
  assert.equal(graph.edges.length, 333);
  assert.equal(new Set(graph.edges.map(({ source }) => source)).size, 117);
  const layout = assertForest(graph);
  assert.equal(layout.clusters.length, 117);
  assert.equal(layout.clusters.reduce((count, { memberIds }) => count + memberIds.length - 1, 0), 217);
  assert.deepEqual(canonicalLayout(layout), canonicalLayout(buildReferralClusterLayout(reverseInput(graph))),
    'large-tree geometry must be deterministic when nodes and edges arrive in reverse order');
});

test('a synthetic 1000-node forest preserves 50 independent parent clusters without geometric collisions', () => {
  const nodes: InputNode[] = [];
  const edges: InputEdge[] = [];
  for (let rootIndex = 0; rootIndex < 50; rootIndex += 1) {
    const rootId = `forest-root-${String(rootIndex).padStart(2, '0')}`;
    nodes.push(node(rootId, 12 + rootIndex % 7));
    for (let leafIndex = 0; leafIndex < 19; leafIndex += 1) {
      const id = `${rootId}-terminal-${String(leafIndex).padStart(2, '0')}`;
      nodes.push(node(id, 6 + leafIndex % 5));
      edges.push(edge(rootId, id));
    }
  }
  assert.equal(nodes.length, 1000);
  assert.equal(edges.length, 950);
  const layout = assertForest({ nodes, edges });
  assert.equal(layout.clusters.length, 50);
});

test('a connected synthetic tree with 250 hubs uses fallback geometry without edge or node collisions', () => {
  const hubIds = Array.from({ length: 250 }, (_, index) => `fallback-hub-${String(index).padStart(3, '0')}`);
  const nodes = hubIds.map((id, index) => node(id, 9 + (index % 8) * 3));
  const edges = hubIds.slice(1).map((id, index) => edge(hubIds[Math.floor(index / 3)], id));
  for (let index = 0; index < hubIds.length; index += 1) {
    const id = `fallback-terminal-${String(index).padStart(3, '0')}`;
    nodes.push(node(id, 5 + (index % 6) * 2));
    edges.push(edge(hubIds[index], id));
  }
  assert.equal(nodes.length, 500);
  assert.equal(edges.length, 499);
  assert.equal(new Set(edges.map(({ source }) => source)).size, 250,
    'the connected component must exceed the 180-hub fallback threshold');
  const graph = { nodes, edges };
  const layout = assertForest(graph);
  assert.equal(layout.clusters.length, 250);
  assert.deepEqual(canonicalLayout(layout), canonicalLayout(buildReferralClusterLayout(reverseInput(graph))),
    'fallback geometry must remain deterministic when caller input order changes');
});
