'use client';

import { forceCollide } from 'd3-force';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import { getReferralGraphNodeRadius } from '@/lib/referral-graph-highlight';
import type { GraphEdge, GraphNode, ReferralGraphPhysicsSettings } from '@/types/referral-graph';

const COLORS = {
  background: '#fbfdff',
  nodeActive: '#ea580c',
  nodeMissing: '#94a3b8',
  nodeDisabled: '#64748b',
  nodeSelected: '#f97316',
  nodeSelectedRing: '#0f172a',
  nodeLegacy: '#ca8a04',
  nodeHighlight: '#facc15',
  nodeHighlightShadow: 'rgba(250,204,21,0.4)',
  edgeLinked: 'rgba(234, 88, 12, 0.62)',
} as const;

const LABEL_ZOOM_THRESHOLD = 1.7;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
const NODE_HIT_SLOP = 6;
const FIT_PADDING = 56;
const FIT_READY_SPAN_THRESHOLD = 24;
const MAX_FIT_RETRY_FRAMES = 48;

type ConfigurableLinkForce = {
  distance: (value: number | ((link: FGLink) => number)) => ConfigurableLinkForce;
  strength: (value: number | ((link: FGLink) => number)) => ConfigurableLinkForce;
  iterations?: (value: number) => ConfigurableLinkForce;
};

type ConfigurableChargeForce = {
  strength: (value: number) => ConfigurableChargeForce;
  distanceMax?: (value: number) => ConfigurableChargeForce;
};

type RuntimeGraphNode = GraphNode & {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
};

type ManualPanState = {
  pointerId: number;
  startClient: { x: number; y: number };
  startCenter: { x: number; y: number };
  startZoom: number;
  lastClient: { x: number; y: number };
  lastTimestamp: number;
  velocity: { x: number; y: number };
};

type FGNode = NodeObject<GraphNode>;
type FGLink = LinkObject<GraphNode, GraphEdge>;
type FitReadiness = {
  canFit: boolean;
  hasPositionedNodes: boolean;
};

type ComponentAnchor = {
  x: number;
  y: number;
};

type ComponentLayout = {
  componentAnchors: Map<number, ComponentAnchor>;
  componentRadii: Map<number, number>;
  componentSizes: Map<number, number>;
  nodeComponentIndex: Map<string, number>;
  nodeAnchorPositions: Map<string, ComponentAnchor>;
  nodeOrderInComponent: Map<string, number>;
};

type GraphPhysicsTuning = {
  anchorStrength: number;
  boundaryStrength: number;
  chargeDistanceMax: number;
  chargeStrength: number;
  collisionPadding: number;
  componentGap: number;
  componentSeparationStrength: number;
  nodeSpreadStrength: number;
  spacingXMultiplier: number;
  spacingYMultiplier: number;
  structuredLinkDistance: number;
  confirmedLinkDistance: number;
  combinedLinkDistance: number;
  structuredLinkStrength: number;
  confirmedLinkStrength: number;
  combinedLinkStrength: number;
};

function hasFiniteCoordinate(value: number | undefined): value is number {
  return Number.isFinite(value);
}

function hasRenderableNodePosition<T extends Pick<RuntimeGraphNode, 'x' | 'y'>>(
  node: T,
): node is T & { x: number; y: number } {
  return hasFiniteCoordinate(node.x) && hasFiniteCoordinate(node.y);
}

function getSlotsPerRing(componentSize: number) {
  return Math.max(8, Math.min(18, Math.ceil(Math.sqrt(componentSize)) * 4));
}

function getSeedPosition(
  index: number,
  anchor: ComponentAnchor = { x: 0, y: 0 },
  componentSize = 1,
): ComponentAnchor {
  if (componentSize <= 1) {
    return { x: anchor.x, y: anchor.y };
  }

  const slotsPerRing = getSlotsPerRing(componentSize);
  const ring = Math.floor(index / slotsPerRing);
  const slot = index % slotsPerRing;
  const angle = ((slot / slotsPerRing) * Math.PI * 2) + (ring * 0.35);
  const radius = 36 + Math.min(componentSize, 12) * 5 + (ring * 48);

  return {
    x: anchor.x + (Math.cos(angle) * radius),
    y: anchor.y + (Math.sin(angle) * radius),
  };
}

function estimateComponentRadius(componentSize: number) {
  if (componentSize <= 1) {
    return 48;
  }

  const slotsPerRing = getSlotsPerRing(componentSize);
  const lastRing = Math.floor((componentSize - 1) / slotsPerRing);
  return 72 + Math.min(componentSize, 12) * 5 + (lastRing * 48);
}

function seedNodePosition(
  node: RuntimeGraphNode,
  index: number,
  anchor: ComponentAnchor = { x: 0, y: 0 },
  componentSize = 1,
) {
  if (hasRenderableNodePosition(node)) {
    return;
  }

  const seed = getSeedPosition(index, anchor, componentSize);
  node.x = seed.x;
  node.y = seed.y;
  node.vx = 0;
  node.vy = 0;
}

function getFitReadiness(nodes: RuntimeGraphNode[]): FitReadiness {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let positionedCount = 0;

  for (const node of nodes) {
    if (!hasRenderableNodePosition(node)) {
      continue;
    }

    positionedCount += 1;
    minX = Math.min(minX, node.x as number);
    maxX = Math.max(maxX, node.x as number);
    minY = Math.min(minY, node.y as number);
    maxY = Math.max(maxY, node.y as number);
  }

  if (positionedCount === 0) {
    return { canFit: false, hasPositionedNodes: false };
  }

  if (nodes.length <= 1) {
    return { canFit: true, hasPositionedNodes: true };
  }

  if (positionedCount < nodes.length) {
    return { canFit: false, hasPositionedNodes: true };
  }

  return {
    canFit: (maxX - minX) >= FIT_READY_SPAN_THRESHOLD || (maxY - minY) >= FIT_READY_SPAN_THRESHOLD,
    hasPositionedNodes: true,
  };
}

function buildAdjacency(edges: GraphEdge[]) {
  const adj = new Map<string, Set<string>>();

  for (const edge of edges) {
    const src = typeof edge.source === 'object' ? (edge.source as GraphNode).id : edge.source;
    const tgt = typeof edge.target === 'object' ? (edge.target as GraphNode).id : edge.target;

    if (!adj.has(src)) adj.set(src, new Set());
    if (!adj.has(tgt)) adj.set(tgt, new Set());
    adj.get(src)?.add(tgt);
    adj.get(tgt)?.add(src);
  }

  return adj;
}

function bfsNeighborhood(startId: string, adj: Map<string, Set<string>>, hops: number) {
  const visited = new Set<string>([startId]);
  let frontier = new Set<string>([startId]);

  for (let i = 0; i < hops; i += 1) {
    const next = new Set<string>();

    for (const nodeId of frontier) {
      for (const neighbor of adj.get(nodeId) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          next.add(neighbor);
        }
      }
    }

    frontier = next;
    if (frontier.size === 0) break;
  }

  return visited;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mapSlider(value: number, min: number, max: number) {
  return min + (((clamp(value, 0, 100) / 100) * (max - min)));
}

function resolveGraphPhysics(settings: ReferralGraphPhysicsSettings): GraphPhysicsTuning {
  const centerRatio = clamp(settings.centerGravity, 0, 100) / 100;
  const repulsionRatio = clamp(settings.repulsion, 0, 100) / 100;

  const baseLinkStrength = mapSlider(settings.linkStrength, 0.34, 0.94);
  const baseLinkDistance = mapSlider(settings.linkDistance, 70, 154);

  return {
    anchorStrength: mapSlider(settings.centerGravity, 0.024, 0.09),
    boundaryStrength: mapSlider(settings.centerGravity, 0.014, 0.048),
    chargeDistanceMax: mapSlider(settings.repulsion, 220, 560),
    chargeStrength: -mapSlider(settings.repulsion, 90, 320),
    collisionPadding: mapSlider(settings.repulsion, 8, 24),
    componentGap: mapSlider(settings.repulsion, 28, 124),
    componentSeparationStrength: mapSlider(settings.repulsion, 0.012, 0.07),
    nodeSpreadStrength: clamp(0.018 + (repulsionRatio * 0.032) + ((clamp(settings.linkStrength, 0, 100) / 100) * 0.024), 0.02, 0.072),
    spacingXMultiplier: clamp(1.6 + (repulsionRatio * 0.95) - (centerRatio * 0.18), 1.52, 2.45),
    spacingYMultiplier: clamp(1.52 + (repulsionRatio * 0.82) - (centerRatio * 0.14), 1.42, 2.22),
    structuredLinkDistance: baseLinkDistance - 6,
    confirmedLinkDistance: baseLinkDistance - 6,
    combinedLinkDistance: baseLinkDistance - 6,
    structuredLinkStrength: clamp(baseLinkStrength + 0.08, 0.26, 0.98),
    confirmedLinkStrength: clamp(baseLinkStrength + 0.08, 0.26, 0.98),
    combinedLinkStrength: clamp(baseLinkStrength + 0.08, 0.26, 0.98),
  };
}

function buildComponentLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): ComponentLayout {
  const visibleIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map<string, Set<string>>();

  for (const node of nodes) {
    adjacency.set(node.id, new Set());
  }

  for (const edge of edges) {
    const sourceId = typeof edge.source === 'object' ? (edge.source as GraphNode).id : edge.source;
    const targetId = typeof edge.target === 'object' ? (edge.target as GraphNode).id : edge.target;

    if (!visibleIds.has(sourceId) || !visibleIds.has(targetId)) {
      continue;
    }

    adjacency.get(sourceId)?.add(targetId);
    adjacency.get(targetId)?.add(sourceId);
  }

  const componentAnchors = new Map<number, ComponentAnchor>();
  const componentRadii = new Map<number, number>();
  const componentSizes = new Map<number, number>();
  const nodeComponentIndex = new Map<string, number>();
  const nodeAnchorPositions = new Map<string, ComponentAnchor>();
  const nodeOrderInComponent = new Map<string, number>();
  const components: string[][] = [];

  for (const node of nodes) {
    if (nodeComponentIndex.has(node.id)) {
      continue;
    }

    const componentIndex = components.length;
    const queue = [node.id];
    const componentNodeIds: string[] = [];
    nodeComponentIndex.set(node.id, componentIndex);

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId) {
        continue;
      }

      componentNodeIds.push(currentId);
      for (const neighborId of adjacency.get(currentId) ?? []) {
        if (nodeComponentIndex.has(neighborId)) {
          continue;
        }

        nodeComponentIndex.set(neighborId, componentIndex);
        queue.push(neighborId);
      }
    }

    componentNodeIds.forEach((componentNodeId, orderIndex) => {
      nodeOrderInComponent.set(componentNodeId, orderIndex);
    });

    componentSizes.set(componentIndex, componentNodeIds.length);
    components.push(componentNodeIds);
  }

  if (components.length <= 1) {
    componentAnchors.set(0, { x: 0, y: 0 });
  } else {
    const maxComponentRadius = components.reduce((largest, componentNodeIds) => {
      return Math.max(largest, estimateComponentRadius(componentNodeIds.length));
    }, 180);
    const columnCount = Math.ceil(Math.sqrt(components.length));
    const rowCount = Math.ceil(components.length / columnCount);
    const spacingX = maxComponentRadius * 2.3;
    const spacingY = maxComponentRadius * 2.08;

    components.forEach((_, componentIndex) => {
      const row = Math.floor(componentIndex / columnCount);
      const column = componentIndex % columnCount;

      componentAnchors.set(componentIndex, {
        x: (column - ((columnCount - 1) / 2)) * spacingX,
        y: (row - ((rowCount - 1) / 2)) * spacingY,
      });
    });
  }

  components.forEach((componentNodeIds, componentIndex) => {
    const anchor = componentAnchors.get(componentIndex) ?? { x: 0, y: 0 };
    const componentSize = componentSizes.get(componentIndex) ?? componentNodeIds.length;
    componentRadii.set(componentIndex, estimateComponentRadius(componentSize));

    componentNodeIds.forEach((componentNodeId, orderIndex) => {
      nodeAnchorPositions.set(componentNodeId, getSeedPosition(orderIndex, anchor, componentSize));
    });
  });

  return {
    componentAnchors,
    componentRadii,
    componentSizes,
    nodeComponentIndex,
    nodeAnchorPositions,
    nodeOrderInComponent,
  };
}

function getNodeRadius(node: GraphNode) {
  return getReferralGraphNodeRadius(node);
}

function resolveEffectiveComponentAnchors(
  layout: ComponentLayout,
  pinnedTargets: Map<string, { x: number; y: number }>,
) {
  const anchorShifts = new Map<number, { x: number; y: number; count: number }>();
  const pinnedComponents = new Set<number>();

  for (const [nodeId, pinnedPosition] of pinnedTargets.entries()) {
    const componentIndex = layout.nodeComponentIndex.get(nodeId);
    if (componentIndex == null) {
      continue;
    }

    const seededPosition = layout.nodeAnchorPositions.get(nodeId);
    const baseAnchor = layout.componentAnchors.get(componentIndex) ?? { x: 0, y: 0 };
    const sourcePosition = seededPosition ?? baseAnchor;
    const shift = anchorShifts.get(componentIndex) ?? { x: 0, y: 0, count: 0 };
    shift.x += pinnedPosition.x - sourcePosition.x;
    shift.y += pinnedPosition.y - sourcePosition.y;
    shift.count += 1;
    anchorShifts.set(componentIndex, shift);
    pinnedComponents.add(componentIndex);
  }

  const anchors = new Map<number, ComponentAnchor>();
  for (const [componentIndex, baseAnchor] of layout.componentAnchors.entries()) {
    const shift = anchorShifts.get(componentIndex);
    if (!shift || shift.count === 0) {
      anchors.set(componentIndex, baseAnchor);
      continue;
    }

    anchors.set(componentIndex, {
      x: baseAnchor.x + (shift.x / shift.count),
      y: baseAnchor.y + (shift.y / shift.count),
    });
  }

  return {
    anchors,
    pinnedComponents,
  };
}

function createComponentAnchoringForce(
  layout: ComponentLayout,
  pinnedTargetsRef: MutableRefObject<Map<string, { x: number; y: number }>>,
  strength = 0.05,
): { (alpha: number): void; initialize: (nodes: FGNode[]) => void } {
  let nodes: FGNode[] = [];

  const force = ((alpha: number) => {
    const centroids = new Map<number, { x: number; y: number; count: number }>();
    const resolvedAnchors = resolveEffectiveComponentAnchors(layout, pinnedTargetsRef.current);

    for (const node of nodes) {
      const current = node as RuntimeGraphNode;
      if (current.x == null || current.y == null) continue;

      const componentIndex = layout.nodeComponentIndex.get(current.id) ?? 0;
      const centroid = centroids.get(componentIndex) ?? { x: 0, y: 0, count: 0 };
      centroid.x += current.x;
      centroid.y += current.y;
      centroid.count += 1;
      centroids.set(componentIndex, centroid);
    }

    for (const node of nodes) {
      const current = node as RuntimeGraphNode;
      if (current.fx != null || current.fy != null || current.x == null || current.y == null) continue;

      const componentIndex = layout.nodeComponentIndex.get(current.id) ?? 0;
      const centroid = centroids.get(componentIndex);
      const target = resolvedAnchors.anchors.get(componentIndex) ?? { x: 0, y: 0 };
      if (!centroid || centroid.count === 0) continue;

      const componentSize = layout.componentSizes.get(componentIndex) ?? 1;
      const componentStrength = strength / Math.max(1, Math.sqrt(componentSize) * 0.72);
      const centerX = centroid.x / centroid.count;
      const centerY = centroid.y / centroid.count;
      const dx = target.x - centerX;
      const dy = target.y - centerY;

      current.vx = (current.vx ?? 0) + (dx * componentStrength * alpha);
      current.vy = (current.vy ?? 0) + (dy * componentStrength * alpha);
    }
  }) as { (alpha: number): void; initialize: (nodes: FGNode[]) => void };

  force.initialize = (initialNodes: FGNode[]) => {
    nodes = initialNodes;
  };

  return force;
}

function createComponentBoundaryForce(
  layout: ComponentLayout,
  pinnedTargetsRef: MutableRefObject<Map<string, { x: number; y: number }>>,
  strength = 0.03,
): { (alpha: number): void; initialize: (nodes: FGNode[]) => void } {
  let nodes: FGNode[] = [];

  const force = ((alpha: number) => {
    const resolvedAnchors = resolveEffectiveComponentAnchors(layout, pinnedTargetsRef.current);

    for (const node of nodes) {
      const current = node as RuntimeGraphNode;
      if (current.fx != null || current.fy != null || current.x == null || current.y == null) continue;

      const componentIndex = layout.nodeComponentIndex.get(current.id) ?? 0;
      const anchor = resolvedAnchors.anchors.get(componentIndex) ?? { x: 0, y: 0 };
      const componentRadius = layout.componentRadii.get(componentIndex) ?? 180;
      const dx = current.x - anchor.x;
      const dy = current.y - anchor.y;
      const distance = Math.hypot(dx, dy);
      const maxDistance = componentRadius * 1.08;
      if (distance <= maxDistance || distance === 0) continue;

      const overflow = distance - maxDistance;
      const pull = (overflow / distance) * strength * alpha;
      current.vx = (current.vx ?? 0) - (dx * pull);
      current.vy = (current.vy ?? 0) - (dy * pull);
    }
  }) as { (alpha: number): void; initialize: (nodes: FGNode[]) => void };

  force.initialize = (initialNodes: FGNode[]) => {
    nodes = initialNodes;
  };

  return force;
}

function createPinnedComponentSpreadForce(
  layout: ComponentLayout,
  pinnedTargetsRef: MutableRefObject<Map<string, { x: number; y: number }>>,
  strength = 0.042,
): { (alpha: number): void; initialize: (nodes: FGNode[]) => void } {
  let nodes: FGNode[] = [];

  const force = ((alpha: number) => {
    const resolvedAnchors = resolveEffectiveComponentAnchors(layout, pinnedTargetsRef.current);
    if (resolvedAnchors.pinnedComponents.size === 0) {
      return;
    }

    for (const node of nodes) {
      const current = node as RuntimeGraphNode;
      if (current.fx != null || current.fy != null || current.x == null || current.y == null) {
        continue;
      }

      const componentIndex = layout.nodeComponentIndex.get(current.id) ?? 0;
      if (!resolvedAnchors.pinnedComponents.has(componentIndex)) {
        continue;
      }

      const baseAnchor = layout.componentAnchors.get(componentIndex) ?? { x: 0, y: 0 };
      const effectiveAnchor = resolvedAnchors.anchors.get(componentIndex) ?? baseAnchor;
      const seededPosition = layout.nodeAnchorPositions.get(current.id);
      if (!seededPosition) {
        continue;
      }

      const target = {
        x: effectiveAnchor.x + (seededPosition.x - baseAnchor.x),
        y: effectiveAnchor.y + (seededPosition.y - baseAnchor.y),
      };
      const componentSize = layout.componentSizes.get(componentIndex) ?? 1;
      const spreadStrength = strength / Math.max(1, Math.sqrt(componentSize) * 0.68);
      current.vx = (current.vx ?? 0) + ((target.x - current.x) * spreadStrength * alpha);
      current.vy = (current.vy ?? 0) + ((target.y - current.y) * spreadStrength * alpha);
    }
  }) as { (alpha: number): void; initialize: (nodes: FGNode[]) => void };

  force.initialize = (initialNodes: FGNode[]) => {
    nodes = initialNodes;
  };

  return force;
}

function createComponentSeparationForce(
  layout: ComponentLayout,
  strength = 0.045,
  gap = 96,
): { (alpha: number): void; initialize: (nodes: FGNode[]) => void } {
  let nodes: FGNode[] = [];

  const force = ((alpha: number) => {
    const centroids = new Map<number, { x: number; y: number; count: number }>();
    const nodesByComponent = new Map<number, RuntimeGraphNode[]>();

    for (const node of nodes) {
      const current = node as RuntimeGraphNode;
      if (current.x == null || current.y == null) continue;

      const componentIndex = layout.nodeComponentIndex.get(current.id) ?? 0;
      const centroid = centroids.get(componentIndex) ?? { x: 0, y: 0, count: 0 };
      centroid.x += current.x;
      centroid.y += current.y;
      centroid.count += 1;
      centroids.set(componentIndex, centroid);

      const bucket = nodesByComponent.get(componentIndex) ?? [];
      bucket.push(current);
      nodesByComponent.set(componentIndex, bucket);
    }

    const componentIds = Array.from(centroids.keys());
    for (let leftIndex = 0; leftIndex < componentIds.length; leftIndex += 1) {
      const leftId = componentIds[leftIndex];
      const leftCentroid = centroids.get(leftId);
      const leftNodes = nodesByComponent.get(leftId);
      if (!leftCentroid || !leftNodes || leftCentroid.count === 0) continue;

      for (let rightIndex = leftIndex + 1; rightIndex < componentIds.length; rightIndex += 1) {
        const rightId = componentIds[rightIndex];
        const rightCentroid = centroids.get(rightId);
        const rightNodes = nodesByComponent.get(rightId);
        if (!rightCentroid || !rightNodes || rightCentroid.count === 0) continue;

        const leftCenterX = leftCentroid.x / leftCentroid.count;
        const leftCenterY = leftCentroid.y / leftCentroid.count;
        const rightCenterX = rightCentroid.x / rightCentroid.count;
        const rightCenterY = rightCentroid.y / rightCentroid.count;
        const dx = rightCenterX - leftCenterX;
        const dy = rightCenterY - leftCenterY;
        const distance = Math.hypot(dx, dy) || 1;
        const minDistance = (layout.componentRadii.get(leftId) ?? 140)
          + (layout.componentRadii.get(rightId) ?? 140)
          + gap;
        if (distance >= minDistance) continue;

        const overlap = minDistance - distance;
        const push = (overlap / distance) * strength * alpha;
        const pushX = dx * push;
        const pushY = dy * push;
        const leftScale = 1 / Math.max(1, Math.sqrt(leftNodes.length));
        const rightScale = 1 / Math.max(1, Math.sqrt(rightNodes.length));

        for (const node of leftNodes) {
          if (node.fx != null || node.fy != null) continue;
          node.vx = (node.vx ?? 0) - (pushX * leftScale);
          node.vy = (node.vy ?? 0) - (pushY * leftScale);
        }

        for (const node of rightNodes) {
          if (node.fx != null || node.fy != null) continue;
          node.vx = (node.vx ?? 0) + (pushX * rightScale);
          node.vy = (node.vy ?? 0) + (pushY * rightScale);
        }
      }
    }
  }) as { (alpha: number): void; initialize: (nodes: FGNode[]) => void };

  force.initialize = (initialNodes: FGNode[]) => {
    nodes = initialNodes;
  };

  return force;
}

function createUserNodeTargetForce(
  targetsRef: MutableRefObject<Map<string, { x: number; y: number }>>,
  strength = 0.12,
): { (alpha: number): void; initialize: (nodes: FGNode[]) => void } {
  let nodes: FGNode[] = [];

  const force = ((alpha: number) => {
    const targets = targetsRef.current;
    if (!targets || targets.size === 0) {
      return;
    }

    for (const node of nodes) {
      const current = node as RuntimeGraphNode;
      const target = targets.get(current.id);
      if (!target || current.fx != null || current.fy != null || current.x == null || current.y == null) {
        continue;
      }

      current.vx = (current.vx ?? 0) + ((target.x - current.x) * strength * alpha);
      current.vy = (current.vy ?? 0) + ((target.y - current.y) * strength * alpha);
    }
  }) as { (alpha: number): void; initialize: (nodes: FGNode[]) => void };

  force.initialize = (initialNodes: FGNode[]) => {
    nodes = initialNodes;
  };

  return force;
}

function getEdgeStyle() {
  return { color: COLORS.edgeLinked, width: 2, dash: null as number[] | null, alpha: 0.72 };
}

function getLinkDistance(physics: GraphPhysicsTuning) {
  return physics.combinedLinkDistance;
}

function getLinkStrength(physics: GraphPhysicsTuning) {
  return physics.combinedLinkStrength;
}

export type ReferralGraphCanvasProps = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedNodeId: string | null;
  searchTerm: string;
  depthHops: 1 | 2 | 3;
  fitRequestId: number;
  resetLayoutRequestId: number;
  physicsSettings: ReferralGraphPhysicsSettings;
  onNodeClick: (node: GraphNode) => void;
  width: number;
  height: number;
};

export function ReferralGraphCanvas({
  nodes,
  edges,
  selectedNodeId,
  searchTerm,
  depthHops,
  fitRequestId,
  resetLayoutRequestId,
  physicsSettings,
  onNodeClick,
  width,
  height,
}: ReferralGraphCanvasProps) {
  const graphRef = useRef<ForceGraphMethods<FGNode, FGLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hasFitOnceRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const nodeDragActiveRef = useRef(false);
  const manualPanStateRef = useRef<ManualPanState | null>(null);
  const viewportInteractionRef = useRef(false);
  const runtimeNodeMapRef = useRef(new Map<string, RuntimeGraphNode>());
  const pinnedNodePositionsRef = useRef(new Map<string, { x: number; y: number }>());
  const lastResetRequestRef = useRef(resetLayoutRequestId);
  const fitRetryRef = useRef<number | null>(null);
  const panMomentumFrameRef = useRef<number | null>(null);
  const [graphReadyTick, setGraphReadyTick] = useState(0);
  const [graphData, setGraphData] = useState<{ nodes: RuntimeGraphNode[]; links: GraphEdge[] }>({
    nodes: [],
    links: [],
  });
  const physics = useMemo(() => resolveGraphPhysics(physicsSettings), [physicsSettings]);
  const componentLayout = useMemo(
    () => buildComponentLayout(nodes, edges),
    [edges, nodes],
  );

  useEffect(() => {
    let rafId = 0;
    let cancelled = false;

    const waitForGraphInstance = () => {
      if (cancelled) return;

      if (graphRef.current) {
        setGraphReadyTick((value) => value + 1);
        return;
      }

      rafId = window.requestAnimationFrame(waitForGraphInstance);
    };

    waitForGraphInstance();

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    if (lastResetRequestRef.current !== resetLayoutRequestId) {
      runtimeNodeMapRef.current.clear();
      pinnedNodePositionsRef.current.clear();
      lastResetRequestRef.current = resetLayoutRequestId;
    }

    const visibleIds = new Set<string>();
    const nodesCopy = nodes.map((node, index) => {
      visibleIds.add(node.id);
      const componentIndex = componentLayout.nodeComponentIndex.get(node.id) ?? 0;
      const componentAnchor = componentLayout.componentAnchors.get(componentIndex) ?? { x: 0, y: 0 };
      const orderInComponent = componentLayout.nodeOrderInComponent.get(node.id) ?? index;
      const componentSize = componentLayout.componentSizes.get(componentIndex) ?? 1;
      const pinnedPosition = pinnedNodePositionsRef.current.get(node.id);
      const existing = runtimeNodeMapRef.current.get(node.id);
      if (existing) {
        Object.assign(existing, node);
        if (pinnedPosition) {
          existing.x = pinnedPosition.x;
          existing.y = pinnedPosition.y;
          existing.fx = pinnedPosition.x;
          existing.fy = pinnedPosition.y;
          existing.vx = 0;
          existing.vy = 0;
        } else {
          existing.fx = undefined;
          existing.fy = undefined;
          seedNodePosition(existing, orderInComponent, componentAnchor, componentSize);
        }
        return existing;
      }

      const runtimeNode: RuntimeGraphNode = { ...node };
      if (pinnedPosition) {
        runtimeNode.x = pinnedPosition.x;
        runtimeNode.y = pinnedPosition.y;
        runtimeNode.fx = pinnedPosition.x;
        runtimeNode.fy = pinnedPosition.y;
        runtimeNode.vx = 0;
        runtimeNode.vy = 0;
      } else {
        seedNodePosition(runtimeNode, orderInComponent, componentAnchor, componentSize);
      }
      runtimeNodeMapRef.current.set(node.id, runtimeNode);
      return runtimeNode;
    });

    for (const nodeId of Array.from(runtimeNodeMapRef.current.keys())) {
      if (!visibleIds.has(nodeId)) {
        runtimeNodeMapRef.current.delete(nodeId);
      }
    }

    setGraphData({
      nodes: nodesCopy,
      links: edges.map((edge) => ({ ...edge })),
    });
  }, [componentLayout, edges, nodes, resetLayoutRequestId]);

  const adjacency = useMemo(() => buildAdjacency(edges), [edges]);

  const neighborSet = useMemo<Set<string> | null>(() => {
    if (!selectedNodeId) return null;
    return bfsNeighborhood(selectedNodeId, adjacency, depthHops);
  }, [selectedNodeId, adjacency, depthHops]);

  const searchMatchSet = useMemo<Set<string> | null>(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return null;

    const matched = new Set<string>();
    for (const node of nodes) {
      const hay = `${node.name} ${node.affiliation} ${node.activeCode ?? ''}`.toLowerCase();
      if (hay.includes(term)) {
        matched.add(node.id);
      }
    }

    return matched;
  }, [nodes, searchTerm]);

  const cancelPendingFit = useCallback(() => {
    if (fitRetryRef.current == null) return;
    window.cancelAnimationFrame(fitRetryRef.current);
    fitRetryRef.current = null;
  }, []);

  const cancelPanMomentum = useCallback(() => {
    if (panMomentumFrameRef.current == null) return;
    window.cancelAnimationFrame(panMomentumFrameRef.current);
    panMomentumFrameRef.current = null;
  }, []);

  const fitGraph = useCallback(
    (durationMs = 500) => {
      const fg = graphRef.current;
      const container = containerRef.current;
      if (!fg || !container || graphData.nodes.length === 0 || width < 2 || height < 2) return false;

      const viewportWidth = Math.floor(container.clientWidth);
      const viewportHeight = Math.floor(container.clientHeight);
      if (viewportWidth < 2 || viewportHeight < 2) return false;

      const currentZoom = fg.zoom();
      if (!Number.isFinite(currentZoom)) {
        fg.zoom(1, 0);
      }

      const currentCenter = fg.centerAt();
      if (!Number.isFinite(currentCenter.x) || !Number.isFinite(currentCenter.y)) {
        fg.centerAt(0, 0, 0);
      }

      fg.zoomToFit(0, FIT_PADDING, (node) => hasRenderableNodePosition(node as RuntimeGraphNode));
      if (durationMs > 0) {
        fg.zoomToFit(durationMs, FIT_PADDING, (node) => hasRenderableNodePosition(node as RuntimeGraphNode));
      }
      return true;
    },
    [graphData.nodes, height, width],
  );

  useEffect(() => {
    return () => {
      cancelPendingFit();
      cancelPanMomentum();
    };
  }, [cancelPanMomentum, cancelPendingFit]);

  const queueFitWhenReady = useCallback(
    (durationMs = 500, options?: { allowAfterInteraction?: boolean }) => {
      cancelPendingFit();

      let frameCount = 0;

      const attemptFit = () => {
        const container = containerRef.current;
        if (!container || graphData.nodes.length === 0 || width < 2 || height < 2) {
          if (frameCount >= MAX_FIT_RETRY_FRAMES) {
            fitRetryRef.current = null;
            return;
          }

          frameCount += 1;
          fitRetryRef.current = window.requestAnimationFrame(attemptFit);
          return;
        }

        if (viewportInteractionRef.current && !options?.allowAfterInteraction) {
          fitRetryRef.current = null;
          return;
        }

        const viewportWidth = Math.floor(container.clientWidth);
        const viewportHeight = Math.floor(container.clientHeight);
        const readiness = getFitReadiness(graphData.nodes);
        const canFitNow = viewportWidth > 1 && viewportHeight > 1 && readiness.canFit;
        const fallbackFit = frameCount >= MAX_FIT_RETRY_FRAMES && readiness.hasPositionedNodes;

        if ((canFitNow || fallbackFit) && fitGraph(durationMs)) {
          hasFitOnceRef.current = true;
          fitRetryRef.current = null;
          return;
        }

        if (frameCount >= MAX_FIT_RETRY_FRAMES) {
          fitRetryRef.current = null;
          return;
        }

        frameCount += 1;
        fitRetryRef.current = window.requestAnimationFrame(attemptFit);
      };

      fitRetryRef.current = window.requestAnimationFrame(attemptFit);
    },
    [cancelPendingFit, fitGraph, graphData.nodes, height, width],
  );

  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    const chargeForce = fg.d3Force('charge') as ConfigurableChargeForce | undefined;
    chargeForce?.strength(physics.chargeStrength);
    chargeForce?.distanceMax?.(physics.chargeDistanceMax);

    const linkForce = fg.d3Force('link') as ConfigurableLinkForce | undefined;
      linkForce?.distance(() => getLinkDistance(physics));
      linkForce?.strength(() => getLinkStrength(physics));
    linkForce?.iterations?.(4);

    fg.d3Force(
      'collision',
      forceCollide<FGNode>()
        .radius((node) => getNodeRadius(node as GraphNode) + physics.collisionPadding)
        .strength(0.98)
        .iterations(4),
    );
    fg.d3Force('center', createComponentAnchoringForce(componentLayout, pinnedNodePositionsRef, physics.anchorStrength));
    fg.d3Force('component-boundary', createComponentBoundaryForce(componentLayout, pinnedNodePositionsRef, physics.boundaryStrength));
    fg.d3Force('pinned-component-spread', createPinnedComponentSpreadForce(componentLayout, pinnedNodePositionsRef, physics.nodeSpreadStrength));
    fg.d3Force(
      'component-separation',
      createComponentSeparationForce(componentLayout, physics.componentSeparationStrength, physics.componentGap),
    );
    fg.d3Force('user-node-target', createUserNodeTargetForce(pinnedNodePositionsRef));
    fg.d3ReheatSimulation();
  }, [componentLayout, graphData, graphReadyTick, physics]);

  useEffect(() => {
    hasFitOnceRef.current = false;
    viewportInteractionRef.current = false;
    cancelPendingFit();
  }, [cancelPendingFit, graphData.links, graphData.nodes, resetLayoutRequestId]);

  useEffect(() => {
    if (!graphData.nodes.length || hasFitOnceRef.current || width < 2 || height < 2) return;

    queueFitWhenReady(600);
  }, [graphData.nodes, graphReadyTick, height, queueFitWhenReady, width]);

  useEffect(() => {
    if (!fitRequestId) return;

    queueFitWhenReady(450, { allowAfterInteraction: true });
  }, [fitRequestId, queueFitWhenReady]);

  useEffect(() => {
    if (!resetLayoutRequestId) return;
    const fg = graphRef.current;
    if (!fg || width < 2 || height < 2) return;

    hasFitOnceRef.current = false;

    const handle = window.requestAnimationFrame(() => {
      fg.d3ReheatSimulation();
      queueFitWhenReady(450, { allowAfterInteraction: true });
    });

    return () => window.cancelAnimationFrame(handle);
  }, [queueFitWhenReady, resetLayoutRequestId, graphReadyTick, height, width]);

  const getCanvasPoint = useCallback((event: PointerEvent | WheelEvent, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);

  const isPointerOnNode = useCallback((graphX: number, graphY: number) => {
    if (!Number.isFinite(graphX) || !Number.isFinite(graphY)) {
      return false;
    }

    for (const node of runtimeNodeMapRef.current.values()) {
      if (!hasRenderableNodePosition(node)) continue;
      const radius = getNodeRadius(node) + NODE_HIT_SLOP;
      const dx = node.x - graphX;
      const dy = node.y - graphY;
      if ((dx * dx) + (dy * dy) <= radius * radius) {
        return true;
      }
    }

    return false;
  }, []);

  useEffect(() => {
    const fg = graphRef.current;
    const container = containerRef.current;
    if (!fg || !container) return;

    container.style.touchAction = 'none';
    container.style.cursor = manualPanStateRef.current ? 'grabbing' : 'grab';

    const startPanMomentum = (velocity: { x: number; y: number }) => {
      cancelPanMomentum();

      const minimumSpeed = 0.02;
      let vx = velocity.x;
      let vy = velocity.y;
      if (Math.hypot(vx, vy) < minimumSpeed) {
        return;
      }

      let lastTimestamp = performance.now();
      const step = (timestamp: number) => {
        const dt = Math.max(8, Math.min(32, timestamp - lastTimestamp));
        lastTimestamp = timestamp;

        const center = fg.centerAt();
        if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
          panMomentumFrameRef.current = null;
          return;
        }

        fg.centerAt(center.x + (vx * dt), center.y + (vy * dt), 0);
        const decay = Math.pow(0.92, dt / 16);
        vx *= decay;
        vy *= decay;

        if (Math.hypot(vx, vy) < minimumSpeed) {
          panMomentumFrameRef.current = null;
          return;
        }

        panMomentumFrameRef.current = window.requestAnimationFrame(step);
      };

      panMomentumFrameRef.current = window.requestAnimationFrame(step);
    };

    const finishPan = (pointerId?: number, options?: { skipMomentum?: boolean }) => {
      const panState = manualPanStateRef.current;
      if (pointerId != null && panState?.pointerId !== pointerId) {
        return;
      }

      if (pointerId != null && container.hasPointerCapture?.(pointerId)) {
        try {
          container.releasePointerCapture(pointerId);
        } catch {
          // ignore capture release failures
        }
      }

      if (panState && !options?.skipMomentum) {
        startPanMomentum(panState.velocity);
      }

      manualPanStateRef.current = null;
      container.style.cursor = nodeDragActiveRef.current ? 'grabbing' : 'grab';
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || nodeDragActiveRef.current) return;

      cancelPanMomentum();

      const point = getCanvasPoint(event, container);
      const graphPoint = fg.screen2GraphCoords(point.x, point.y);
      if (isPointerOnNode(graphPoint.x, graphPoint.y)) return;

      const startCenter = fg.centerAt();
      const startZoom = fg.zoom();
      if (!Number.isFinite(startCenter.x) || !Number.isFinite(startCenter.y) || !Number.isFinite(startZoom)) {
        return;
      }

      manualPanStateRef.current = {
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        startCenter,
        startZoom,
        lastClient: { x: event.clientX, y: event.clientY },
        lastTimestamp: performance.now(),
        velocity: { x: 0, y: 0 },
      };
      viewportInteractionRef.current = true;

      try {
        container.setPointerCapture?.(event.pointerId);
      } catch {
        // ignore capture failures
      }

      container.style.cursor = 'grabbing';
      event.preventDefault();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const panState = manualPanStateRef.current;
      if (!panState || panState.pointerId !== event.pointerId) return;

      const dx = event.clientX - panState.startClient.x;
      const dy = event.clientY - panState.startClient.y;
      const zoom = Math.max(panState.startZoom, MIN_ZOOM);
      const nextCenter = {
        x: panState.startCenter.x - (dx / zoom),
        y: panState.startCenter.y - (dy / zoom),
      };
      fg.centerAt(
        nextCenter.x,
        nextCenter.y,
        0,
      );

      const now = performance.now();
      const dt = Math.max(8, now - panState.lastTimestamp);
      const stepDx = event.clientX - panState.lastClient.x;
      const stepDy = event.clientY - panState.lastClient.y;
      const instantVelocity = {
        x: -(stepDx / zoom) / dt,
        y: -(stepDy / zoom) / dt,
      };
      panState.velocity = {
        x: (panState.velocity.x * 0.45) + (instantVelocity.x * 0.55),
        y: (panState.velocity.y * 0.45) + (instantVelocity.y * 0.55),
      };
      panState.lastClient = { x: event.clientX, y: event.clientY };
      panState.lastTimestamp = now;
      event.preventDefault();
    };

    const handlePointerUp = (event: PointerEvent) => {
      finishPan(event.pointerId);
    };

    const handleWheel = (event: WheelEvent) => {
      cancelPanMomentum();
      const point = getCanvasPoint(event, container);
      const before = fg.screen2GraphCoords(point.x, point.y);
      if (!Number.isFinite(before.x) || !Number.isFinite(before.y)) {
        event.preventDefault();
        return;
      }

      const currentZoom = fg.zoom();
      if (!Number.isFinite(currentZoom)) {
        event.preventDefault();
        return;
      }

      const scaleFactor = Math.exp(-event.deltaY * 0.0015);
      const nextZoom = clamp(currentZoom * scaleFactor, MIN_ZOOM, MAX_ZOOM);
      viewportInteractionRef.current = true;

      if (Math.abs(nextZoom - currentZoom) < 0.0001) {
        event.preventDefault();
        return;
      }

      const center = fg.centerAt();
      if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
        event.preventDefault();
        return;
      }

      fg.zoom(nextZoom, 0);
      const after = fg.screen2GraphCoords(point.x, point.y);
      if (!Number.isFinite(after.x) || !Number.isFinite(after.y)) {
        event.preventDefault();
        return;
      }

      fg.centerAt(center.x + (before.x - after.x), center.y + (before.y - after.y), 0);
      event.preventDefault();
    };

    container.addEventListener('pointerdown', handlePointerDown, true);
    container.addEventListener('pointermove', handlePointerMove, true);
    container.addEventListener('pointerup', handlePointerUp, true);
    container.addEventListener('pointercancel', handlePointerUp, true);
    container.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    return () => {
      cancelPanMomentum();
      finishPan(undefined, { skipMomentum: true });
      container.removeEventListener('pointerdown', handlePointerDown, true);
      container.removeEventListener('pointermove', handlePointerMove, true);
      container.removeEventListener('pointerup', handlePointerUp, true);
      container.removeEventListener('pointercancel', handlePointerUp, true);
      container.removeEventListener('wheel', handleWheel, true);
    };
  }, [cancelPanMomentum, getCanvasPoint, graphData.nodes.length, graphReadyTick, isPointerOnNode, width, height]);

  const nodeCanvasObject = useCallback(
    (rawNode: FGNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const node = rawNode as RuntimeGraphNode;
      if (node.x == null || node.y == null) return;

      const isSelected = node.id === selectedNodeId;
      const isSearchMatch = searchMatchSet ? searchMatchSet.has(node.id) : false;
      const isInNeighborhood = neighborSet ? neighborSet.has(node.id) : true;
      const visible = isInNeighborhood && (!searchMatchSet || isSearchMatch || isSelected);
      const radius = getNodeRadius(node);
      const isPinned = node.fx != null && node.fy != null;
      const isHighlighted = node.highlightType != null;
      const showDetailedLabel = isSelected || isSearchMatch || globalScale >= LABEL_ZOOM_THRESHOLD;
      const label = showDetailedLabel && node.activeCode ? `${node.name} · ${node.activeCode}` : node.name;

      ctx.globalAlpha = visible ? 1 : selectedNodeId || searchMatchSet ? 0.12 : 1;

      let fillColor: string = COLORS.nodeMissing;
      let shadowColor = 'rgba(148,163,184,0.22)';
      if (isHighlighted) {
        fillColor = COLORS.nodeHighlight;
        shadowColor = COLORS.nodeHighlightShadow;
      } else if (isSelected) {
        fillColor = COLORS.nodeSelected;
        shadowColor = 'rgba(249,115,22,0.38)';
      } else if (node.nodeStatus === 'has_active_code') {
        fillColor = COLORS.nodeActive;
        shadowColor = 'rgba(234,88,12,0.26)';
      } else if (node.nodeStatus === 'code_disabled') {
        fillColor = COLORS.nodeDisabled;
        shadowColor = 'rgba(100,116,139,0.22)';
      }

      if (isSelected && isHighlighted) {
        shadowColor = 'rgba(250,204,21,0.52)';
      }

      ctx.save();
      ctx.shadowBlur = isSelected ? 26 : isHighlighted ? 22 : 16;
      ctx.shadowColor = shadowColor;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.restore();

      if (isHighlighted) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.nodeActive;
        ctx.lineWidth = 1.6 / Math.max(globalScale, 0.85);
        ctx.stroke();
      }

      if (node.hasLegacyUnresolved) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 2, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.nodeLegacy;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = COLORS.nodeSelectedRing;
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }

      if (isPinned) {
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([
          5 / Math.max(globalScale, 0.85),
          4 / Math.max(globalScale, 0.85),
        ]);
        ctx.arc(node.x, node.y, radius + 7, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.56)';
        ctx.lineWidth = 1.4 / Math.max(globalScale, 0.85);
        ctx.stroke();
        ctx.restore();
      }

      const fontSize = Math.max(12 / Math.max(globalScale, 0.7), 10);
      ctx.font = `600 ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const labelY = node.y + radius + 8 / Math.max(globalScale, 0.8);

      ctx.save();
      ctx.shadowBlur = 8 / Math.max(globalScale, 0.85);
      ctx.shadowColor = 'rgba(255, 255, 255, 0.78)';
      ctx.lineWidth = 3.2 / Math.max(globalScale, 0.85);
      ctx.strokeStyle = 'rgba(248, 250, 252, 0.94)';
      ctx.strokeText(label, node.x, labelY);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0f172a';
      ctx.fillText(label, node.x, labelY);
      ctx.restore();

      ctx.globalAlpha = 1;
    },
    [neighborSet, searchMatchSet, selectedNodeId],
  );

  const nodePointerAreaPaint = useCallback((rawNode: FGNode, paintColor: string, ctx: CanvasRenderingContext2D) => {
    const node = rawNode as RuntimeGraphNode;
    if (node.x == null || node.y == null) return;

    ctx.fillStyle = paintColor;
    ctx.beginPath();
    ctx.arc(node.x, node.y, getNodeRadius(node) + 2, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  const linkCanvasObject = useCallback(
    (rawLink: FGLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const src = rawLink.source as RuntimeGraphNode | undefined;
      const tgt = rawLink.target as RuntimeGraphNode | undefined;
      if (!src || !tgt || src.x == null || src.y == null || tgt.x == null || tgt.y == null) return;

      const edgeStyle = getEdgeStyle();
      const isRelevant = !neighborSet || (neighborSet.has(src.id) && neighborSet.has(tgt.id));
      const isSearchRelevant = !searchMatchSet || searchMatchSet.has(src.id) || searchMatchSet.has(tgt.id);
      const alpha = isRelevant && isSearchRelevant ? edgeStyle.alpha : 0.1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = edgeStyle.color;
      ctx.lineWidth = edgeStyle.width / Math.max(globalScale, 0.7);
      if (edgeStyle.dash) {
        ctx.setLineDash(edgeStyle.dash.map((value) => value / Math.max(globalScale, 0.85)));
      } else {
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);
      ctx.stroke();
      ctx.restore();
    },
    [neighborSet, searchMatchSet],
  );

  const handleNodeClick = useCallback(
    (rawNode: FGNode) => {
      if (Date.now() < suppressClickUntilRef.current || manualPanStateRef.current) return;
      onNodeClick(rawNode as GraphNode);
    },
    [onNodeClick],
  );

  const handleNodeDrag = useCallback((rawNode: FGNode) => {
    cancelPanMomentum();
    const node = rawNode as RuntimeGraphNode;
    nodeDragActiveRef.current = true;
    viewportInteractionRef.current = true;
    if (node.x != null && node.y != null) {
      node.fx = node.x;
      node.fy = node.y;
    }
  }, [cancelPanMomentum]);

  const handleNodeDragEnd = useCallback((rawNode: FGNode) => {
    const node = rawNode as RuntimeGraphNode;
    if (node.x != null && node.y != null) {
      pinnedNodePositionsRef.current.set(node.id, { x: node.x, y: node.y });
      node.fx = node.x;
      node.fy = node.y;
      node.vx = 0;
      node.vy = 0;
    }

    nodeDragActiveRef.current = false;
    suppressClickUntilRef.current = Date.now() + 500;
    graphRef.current?.d3ReheatSimulation();

    const container = containerRef.current;
    if (container instanceof HTMLDivElement) {
      container.style.cursor = 'grab';
    }
  }, []);

  const nodeLabel = useCallback(
    (rawNode: FGNode) => {
      const node = rawNode as GraphNode;
      const isSearchMatch = searchMatchSet ? searchMatchSet.has(node.id) : false;
      return `${node.name}${node.id === selectedNodeId || isSearchMatch ? (node.activeCode ? ` · ${node.activeCode}` : '') : ''}`;
    },
    [searchMatchSet, selectedNodeId],
  );

  return (
    <div ref={containerRef} style={{ width, height, touchAction: 'none' }}>
      <ForceGraph2D
        ref={graphRef as MutableRefObject<ForceGraphMethods<FGNode, FGLink> | undefined>}
        graphData={graphData}
        width={width}
        height={height}
        backgroundColor={COLORS.background}
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={nodePointerAreaPaint}
        nodeCanvasObjectMode={() => 'replace'}
        linkCanvasObject={linkCanvasObject}
        linkCanvasObjectMode={() => 'replace'}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={1}
        nodeLabel={nodeLabel}
        onNodeClick={handleNodeClick}
        onNodeDrag={handleNodeDrag}
        onNodeDragEnd={handleNodeDragEnd}
        enableNodeDrag
        enableZoomInteraction={false}
        enablePanInteraction={false}
        enablePointerInteraction
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        d3AlphaDecay={0.038}
        d3VelocityDecay={0.26}
        cooldownTicks={180}
        warmupTicks={30}
      />
    </div>
  );
}
