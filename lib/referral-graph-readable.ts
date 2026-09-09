import {
  getReferralGraphNodeScreenRadius,
  normalizeReferralGraph,
  REFERRAL_GRAPH_MAX_SCALE,
  REFERRAL_GRAPH_SURFACE_CENTER,
  REFERRAL_GRAPH_SURFACE_SIZE,
} from './referral-graph-native';
import type { ReferralGraphEdge, ReferralGraphNode, ReferralGraphPoint } from '@/types/referral-graph';

export const REFERRAL_GRAPH_LABEL_GAP = 6;
export const REFERRAL_GRAPH_VISUAL_MAX_SCALE = 1.4;
export const REFERRAL_GRAPH_HIT_SIZE = 48;
const DEPTH_GAP = 168;
const CLEARANCE = 12;

export type GraphLabelSize = { width: number; height: number };
export type GraphLabelPlacement = GraphLabelSize & { offsetX: number; offsetY: number; showDetails?: boolean };
export type GraphRect = { x: number; y: number; width: number; height: number };

export function getReferralGraphLabelText(name: string) {
  const characters = Array.from(name);
  return characters.length > 10 ? `${characters.slice(0, 10).join('')}…` : name;
}

// The Text uses this exact width and ellipsizes inside it. Collision bounds therefore
// do not depend on a font engine's estimate of the visible glyph widths.
export function getReferralGraphLabelSize(name: string, fontScale = 1): GraphLabelSize {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  return {
    width: Math.min(120, Math.max(34, Array.from(getReferralGraphLabelText(name)).length * 11 + 6)) * scale,
    height: 14 * scale,
  };
}

export function getReferralGraphVisualScale(scale: number) {
  'worklet';
  // Slightly strengthen overview dots without consuming the reserved node clearance.
  return Math.max(0, Math.min(Math.max(scale, Math.min(0.1, scale * 2)), REFERRAL_GRAPH_VISUAL_MAX_SCALE));
}

function footprint(node: ReferralGraphNode, fontScale: number) {
  const label = getReferralGraphLabelSize(node.name, fontScale);
  const radius = getReferralGraphNodeScreenRadius(node.totalDescendantCount)
    * REFERRAL_GRAPH_VISUAL_MAX_SCALE;
  return Math.max(REFERRAL_GRAPH_HIT_SIZE / 2, Math.hypot(
    label.width / 2,
    radius + REFERRAL_GRAPH_LABEL_GAP + label.height,
  ));
}

/** A deterministic spanning forest supplies angular order; original edges are untouched.
 * Radial tracks then grow to satisfy pair clearance, including narrow branch sectors.
 * Logical coordinates deliberately remain uncompressed and can exceed the bitmap bounds.
 */
export function buildReadableReferralGraphLayout(
  rawNodes: ReferralGraphNode[],
  rawEdges: ReferralGraphEdge[],
  fontScale = 1,
) {
  const { nodes, edges } = normalizeReferralGraph(rawNodes, rawEdges);
  const positions = new Map<string, ReferralGraphPoint>();
  if (!nodes.length) return positions;
  const rank = new Map(nodes.map((node, index) => [node.id, index]));
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const inbound = new Set(edges.map((edge) => edge.target));
  for (const edge of edges) adjacency.get(edge.source)!.push(edge.target);
  for (const children of adjacency.values()) children.sort((a, b) => rank.get(a)! - rank.get(b)!);
  const root = nodes.find((node) => node.isViewer)
    ?? nodes.find((node) => !inbound.has(node.id)) ?? nodes[0];
  const tree = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const depth = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  const visitComponent = (start: number) => {
    for (let cursor = start; cursor < queue.length; cursor += 1) {
      const parent = queue[cursor];
      for (const child of adjacency.get(parent)!) {
        if (depth.has(child)) continue;
        tree.get(parent)!.push(child);
        depth.set(child, depth.get(parent)! + 1);
        queue.push(child);
      }
    }
  };
  visitComponent(0);
  for (const node of nodes) {
    if (depth.has(node.id)) continue;
    // A disconnected component occupies its own sector, without fabricating an edge.
    tree.get(root.id)!.push(node.id);
    depth.set(node.id, 1);
    queue.push(node.id);
    visitComponent(queue.length - 1);
  }
  const radius = new Map(nodes.map((node) => [node.id, footprint(node, fontScale)]));
  const weight = new Map<string, number>();
  for (const id of queue.slice().reverse()) {
    weight.set(id, Math.max(radius.get(id)! * 2,
      tree.get(id)!.reduce((total, child) => total + weight.get(child)!, 0)));
  }
  const angles = new Map<string, number>();
  const sectors = new Map<string, [number, number]>([[root.id, [-Math.PI, Math.PI]]]);
  for (const id of queue) {
    const [start, end] = sectors.get(id)!;
    angles.set(id, (start + end) / 2);
    const children = tree.get(id)!;
    const total = children.reduce((sum, child) => sum + weight.get(child)!, 0);
    let cursor = start;
    for (const child of children) {
      // Footprint weights already reserve space for every small sibling. Adding an
      // equal-angle floor at each generation would exponentially squeeze deep branches.
      const sweep = (end - start) * weight.get(child)! / total;
      sectors.set(child, [cursor, cursor + sweep]);
      cursor += sweep;
    }
  }
  const center = REFERRAL_GRAPH_SURFACE_CENTER;
  const parentById = new Map<string, string>();
  for (const [parent, children] of tree) for (const child of children) parentById.set(child, parent);
  const distanceById = new Map<string, number>([[root.id, 0]]);
  const outerRadiusByDepth = new Map<number, number>([[0, 0]]);
  positions.set(root.id, { x: center, y: center });
  const placed = [root.id];
  const placementOrder = queue.slice(1).sort((a, b) => depth.get(a)! - depth.get(b)!
    || angles.get(b)! - angles.get(a)! || rank.get(a)! - rank.get(b)!);
  for (const id of placementOrder) {
    const angle = angles.get(id)!;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    let distance = Math.max(distanceById.get(parentById.get(id)!)!, outerRadiusByDepth.get(depth.get(id)! - 1) ?? 0) + DEPTH_GAP;
    // Keep branch angles, but permit siblings on different radial tracks. A shared
    // radius for an entire generation wastes space around a single dense sector.
    const forbidden: [number, number][] = [];
    for (const otherId of placed) {
      const other = positions.get(otherId)!;
      const dx = other.x - center;
      const dy = other.y - center;
      const projection = dx * ux + dy * uy;
      const separation = radius.get(id)! + radius.get(otherId)! + CLEARANCE;
      const perpendicularSquared = Math.max(0, dx * dx + dy * dy - projection * projection);
      if (perpendicularSquared >= separation * separation) continue;
      const half = Math.sqrt(separation * separation - perpendicularSquared);
      if (projection + half >= distance) forbidden.push([projection - half, projection + half]);
    }
    forbidden.sort((a, b) => a[0] - b[0]);
    for (const [lower, upper] of forbidden) {
      if (lower <= distance && distance <= upper) distance = upper + 0.00001;
    }
    distanceById.set(id, distance);
    outerRadiusByDepth.set(depth.get(id)!, Math.max(outerRadiusByDepth.get(depth.get(id)!) ?? 0, distance));
    positions.set(id, { x: center + ux * distance, y: center + uy * distance });
    placed.push(id);
  }
  return positions;
}

export function getReferralGraphLogicalSurface(positions: Map<string, ReferralGraphPoint>) {
  const center = REFERRAL_GRAPH_SURFACE_CENTER;
  let offset = REFERRAL_GRAPH_SURFACE_SIZE / 2;
  for (const point of positions.values()) {
    offset = Math.max(offset, Math.abs(point.x - center) + 160, Math.abs(point.y - center) + 160);
  }
  return { size: offset * 2, origin: center - offset };
}

export function getReadableReferralGraphViewport(options: {
  positions: Map<string, ReferralGraphPoint>;
  width: number;
  height: number;
  padding?: number;
}) {
  const { positions, width, height } = options;
  if (!positions.size || width <= 0 || height <= 0) return { scale: 1, panX: 0, panY: 0 };
  const points = Array.from(positions.values());
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const padding = Math.min(options.padding ?? 56, width / 4, height / 4);
  const scale = Math.min(1.4, (width - padding * 2) / Math.max(80, maxX - minX),
    (height - padding * 2) / Math.max(80, maxY - minY));
  return {
    scale,
    panX: -((minX + maxX) / 2 - REFERRAL_GRAPH_SURFACE_CENTER) * scale,
    panY: -((minY + maxY) / 2 - REFERRAL_GRAPH_SURFACE_CENTER) * scale,
  };
}

export function clampReadableReferralGraphScale(scale: number, fitScale: number) {
  'worklet';
  return Math.min(REFERRAL_GRAPH_MAX_SCALE, Math.max(Math.min(0.25, fitScale), scale));
}

export function graphRectsOverlap(a: GraphRect, b: GraphRect, gap = 0) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

export function projectReferralGraphPoint(
  point: ReferralGraphPoint,
  scale: number,
  panX: number,
  panY: number,
  width: number,
  height: number,
) {
  'worklet';
  return {
    x: (point.x - REFERRAL_GRAPH_SURFACE_CENTER) * scale + panX + width / 2,
    y: (point.y - REFERRAL_GRAPH_SURFACE_CENTER) * scale + panY + height / 2,
  };
}

export function graphRectIntersectsCircle(rect: GraphRect, point: ReferralGraphPoint, radius: number) {
  const closestX = Math.max(rect.x, Math.min(rect.x + rect.width, point.x));
  const closestY = Math.max(rect.y, Math.min(rect.y + rect.height, point.y));
  return Math.hypot(closestX - point.x, closestY - point.y) < radius;
}

type CollisionEntry<T> = { value: T; visitedAt: number };

/** The grid only narrows candidates; exact collision rules still decide placement. */
export class LabelCollisionIndex<T> {
  private readonly columns = new Map<number, Map<number, CollisionEntry<T>[]>>();
  private readonly entries: CollisionEntry<T>[] = [];
  private readonly overflow: CollisionEntry<T>[] = [];
  private queryId = 0;

  private range(rect: GraphRect) {
    const left = Math.floor(rect.x / 64);
    const right = Math.floor((rect.x + rect.width) / 64);
    const top = Math.floor(rect.y / 64);
    const bottom = Math.floor((rect.y + rect.height) / 64);
    const cells = (right - left + 1) * (bottom - top + 1);
    // Unusual coordinates or very large text must not create an unbounded grid walk.
    if (![left, right, top, bottom].every(Number.isSafeInteger) || cells <= 0 || cells > 256) return null;
    return { left, right, top, bottom };
  }

  insert(rect: GraphRect, value: T) {
    const entry = { value, visitedAt: 0 };
    this.entries.push(entry);
    const range = this.range(rect);
    if (!range) {
      this.overflow.push(entry);
      return;
    }
    for (let x = range.left; x <= range.right; x += 1) {
      let column = this.columns.get(x);
      if (!column) {
        column = new Map();
        this.columns.set(x, column);
      }
      for (let y = range.top; y <= range.bottom; y += 1) {
        const bucket = column.get(y);
        if (bucket) bucket.push(entry);
        else column.set(y, [entry]);
      }
    }
  }

  some(rect: GraphRect, intersects: (value: T) => boolean) {
    const range = this.range(rect);
    if (!range) return this.entries.some((entry) => intersects(entry.value));
    if (this.overflow.some((entry) => intersects(entry.value))) return true;
    const queryId = ++this.queryId;
    for (let x = range.left; x <= range.right; x += 1) {
      const column = this.columns.get(x);
      if (!column) continue;
      for (let y = range.top; y <= range.bottom; y += 1) {
        for (const entry of column.get(y) ?? []) {
          if (entry.visitedAt === queryId) continue;
          entry.visitedAt = queryId;
          if (intersects(entry.value)) return true;
        }
      }
    }
    return false;
  }
}

/** Greedy screen-space placement. Hidden labels never remove nodes or hit targets. */
export function buildReferralGraphLabels(options: {
  nodes: ReferralGraphNode[];
  positions: Map<string, ReferralGraphPoint>;
  scale: number;
  selectedNodeId?: string | null;
  fontScale?: number;
  detailSizes?: ReadonlyMap<string, GraphLabelSize>;
}) {
  const { nodes, positions, scale, selectedNodeId, fontScale = 1, detailSizes } = options;
  const result = new Map<string, GraphLabelPlacement>();
  const occupied = new LabelCollisionIndex<GraphRect>();
  type Circle = ReferralGraphPoint & { id: string; radius: number };
  const circles = new LabelCollisionIndex<Circle>();
  const circleById = new Map<string, Circle>();
  const priority = (node: ReferralGraphNode) => node.id === selectedNodeId ? 2 : node.isViewer ? 1 : 0;
  const sorted = nodes.slice().sort((a, b) => priority(b) - priority(a)
    || b.totalDescendantCount - a.totalDescendantCount || a.id.localeCompare(b.id));
  for (const node of nodes) {
    const point = positions.get(node.id);
    if (!point) continue;
    const circle = { id: node.id, x: point.x * scale, y: point.y * scale,
      radius: getReferralGraphNodeScreenRadius(node.totalDescendantCount) * getReferralGraphVisualScale(scale)
        + (node.id === selectedNodeId ? 9 * getReferralGraphVisualScale(scale) : 0) };
    // Preserve the previous first-match lookup even for duplicate input IDs.
    if (!circleById.has(node.id)) circleById.set(node.id, circle);
    const clearance = circle.radius + 3;
    circles.insert({ x: circle.x - clearance, y: circle.y - clearance,
      width: clearance * 2, height: clearance * 2 }, circle);
  }
  for (const node of sorted) {
    const point = positions.get(node.id);
    if (!point) continue;
    const nameSize = getReferralGraphLabelSize(node.name, fontScale);
    const detailSize = detailSizes?.get(node.id);
    const circle = circleById.get(node.id)!;
    const offset = circle.radius + REFERRAL_GRAPH_LABEL_GAP;
    // Name and details share one collision rectangle anchored to their own node.
    // If the complete card cannot fit, retain a compact name instead of detaching amounts.
    for (const size of detailSize ? [detailSize, nameSize] : [nameSize]) {
      const { width, height } = size;
      const bottom = { offsetX: -width / 2, offsetY: offset };
      const right = { offsetX: offset, offsetY: -height / 2 };
      const left = { offsetX: -width - offset, offsetY: -height / 2 };
      const top = { offsetX: -width / 2, offsetY: -height - offset };
      const candidates = size === detailSize ? [right, left, bottom, top] : [bottom, right, left, top];
      for (const candidate of candidates) {
        const rect = { x: point.x * scale + candidate.offsetX, y: point.y * scale + candidate.offsetY, width, height };
        if (occupied.some(rect, (other) => graphRectsOverlap(rect, other, 4))) continue;
        if (circles.some(rect, (other) => graphRectIntersectsCircle(rect, other, other.radius + 3))) continue;
        occupied.insert({ x: rect.x - 4, y: rect.y - 4, width: rect.width + 8, height: rect.height + 8 }, rect);
        result.set(node.id, { ...candidate, width, height, ...(detailSize ? { showDetails: size === detailSize } : {}) });
        break;
      }
      if (result.has(node.id)) break;
    }
  }
  return result;
}
