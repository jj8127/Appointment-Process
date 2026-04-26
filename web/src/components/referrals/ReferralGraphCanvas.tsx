'use client';

import { forceManyBody, type ForceLink } from 'd3-force';
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from 'react-force-graph-2d';
import {
  buildReferralGraphLayout,
  type GraphLayoutPoint,
} from '@/lib/referral-graph-layout';
import { getReferralGraphLabelPresentation } from '@/lib/referral-graph-display';
import { getReferralGraphNodeRadius } from '@/lib/referral-graph-highlight';
import {
  buildReferralGraphAdjacency,
  getReferralGraphConnectedNodeIds,
} from '@/lib/referral-graph-interaction';
import {
  applyReferralGraphDragSpring,
  createReferralGraphBranchBendForce,
  createReferralGraphComponentEnvelopeForce,
  createReferralGraphClusterGravityForce,
  createReferralGraphClusterSeparationForce,
  createReferralGraphDragSpringForce,
  createReferralGraphLinkTensionForce,
  createReferralGraphNodeSeparationForce,
  createReferralGraphSiblingAngularForce,
  getReferralGraphLinkDistance,
  resolveReferralGraphPhysics,
} from '@/lib/referral-graph-physics';
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
  edgeLinked: 'rgba(100, 116, 139, 0.34)',
  edgeFocused: 'rgba(234, 88, 12, 0.72)',
} as const;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 6;
const NODE_HIT_SLOP = 6;
const FIT_PADDING = 56;
const FIT_READY_SPAN_THRESHOLD = 24;
const MAX_FIT_RETRY_FRAMES = 48;
const LAYOUT_VERSION = 'obsidian-pinwheel-v14';

type RuntimeGraphNode = GraphNode & {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
  __layoutVersion?: string;
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

type ComponentAnchor = GraphLayoutPoint;
type ConfigurableLinkForce = ForceLink<FGNode, FGLink>;
type LinkForceAccessors = {
  distance: () => (link: FGLink, index: number, links: FGLink[]) => number;
  strength: () => (link: FGLink, index: number, links: FGLink[]) => number;
};
type ReferralGraphDebugWindow = Window & {
  __referralGraphPhysicsDebug?: {
    nodeCount: number;
    linkCount: number;
    linkDistance: number;
    linkStrength: number;
    minLinkStrength: number;
    maxLinkStrength: number;
    centerStrength: number;
    chargeStrength: number;
  };
};

function hasFiniteCoordinate(value: number | undefined): value is number {
  return Number.isFinite(value);
}

function hasRenderableNodePosition<T extends Pick<RuntimeGraphNode, 'x' | 'y'>>(
  node: T,
): node is T & { x: number; y: number } {
  return hasFiniteCoordinate(node.x) && hasFiniteCoordinate(node.y);
}

function seedNodePosition(node: RuntimeGraphNode, anchor: ComponentAnchor = { x: 0, y: 0 }, force = false) {
  if (!force && hasRenderableNodePosition(node)) {
    return;
  }

  node.x = anchor.x;
  node.y = anchor.y;
  node.vx = 0;
  node.vy = 0;
  node.fx = undefined;
  node.fy = undefined;
  node.__layoutVersion = LAYOUT_VERSION;
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

function getEdgeEndpointId(value: GraphEdge['source'] | GraphEdge['target'] | GraphNode) {
  return typeof value === 'object' ? (value as GraphNode).id : value;
}

function getRuntimeLinkEndpointId(value: FGLink['source'] | FGLink['target']) {
  return typeof value === 'object' ? (value as GraphNode).id : value;
}

function buildDegreeMap(edges: GraphEdge[]) {
  const degreeByNodeId = new Map<string, number>();

  for (const edge of edges) {
    const source = getEdgeEndpointId(edge.source);
    const target = getEdgeEndpointId(edge.target);
    degreeByNodeId.set(source, (degreeByNodeId.get(source) ?? 0) + 1);
    degreeByNodeId.set(target, (degreeByNodeId.get(target) ?? 0) + 1);
  }

  return degreeByNodeId;
}

function buildDirectedChildCountMap(edges: GraphEdge[]) {
  const childCountByNodeId = new Map<string, number>();

  for (const edge of edges) {
    const source = getEdgeEndpointId(edge.source);
    childCountByNodeId.set(source, (childCountByNodeId.get(source) ?? 0) + 1);
  }

  return childCountByNodeId;
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

function getDragAffectedNodeIds(nodeId: string, adj: Map<string, Set<string>>) {
  return getReferralGraphConnectedNodeIds(nodeId, adj);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getNodeRadius(node: GraphNode) {
  return getReferralGraphNodeRadius(node);
}

function getEdgeStyle() {
  return { color: COLORS.edgeLinked, width: 1.05, dash: null as number[] | null, alpha: 0.5 };
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
  const draggedNodeIdRef = useRef<string | null>(null);
  const userMovedNodeIdsRef = useRef(new Set<string>());
  const userMovedNodeTargetsRef = useRef(new Map<string, GraphLayoutPoint>());
  const dragMemorySuppressedNodeIdsRef = useRef(new Set<string>());
  const lastDragReheatAtRef = useRef(0);
  const lastResetRequestRef = useRef(resetLayoutRequestId);
  const fitRetryRef = useRef<number | null>(null);
  const settledFitTimerRef = useRef<number | null>(null);
  const panMomentumFrameRef = useRef<number | null>(null);
  const [graphReadyTick, setGraphReadyTick] = useState(0);
  const [graphData, setGraphData] = useState<{ nodes: RuntimeGraphNode[]; links: GraphEdge[] }>({
    nodes: [],
    links: [],
  });
  const physics = useMemo(() => resolveReferralGraphPhysics(physicsSettings), [physicsSettings]);
  const componentLayout = useMemo(
    () => buildReferralGraphLayout(nodes, edges, physics.linkDistance, getReferralGraphLinkDistance),
    [edges, nodes, physics.linkDistance],
  );
  const gravityNodeClusterIndex = useMemo(() => {
    const nextIndexByNodeId = new Map(componentLayout.nodeComponentIndex);
    let nextIndex = componentLayout.componentRadii.size;
    for (const nodeId of componentLayout.nodeClusterIndex.keys()) {
      if (nextIndexByNodeId.has(nodeId)) {
        continue;
      }
      nextIndexByNodeId.set(nodeId, nextIndex);
      nextIndex += 1;
    }
    return nextIndexByNodeId;
  }, [componentLayout]);
  const graphDegreeByNodeId = useMemo(() => buildDegreeMap(graphData.links), [graphData.links]);
  const graphChildCountByNodeId = useMemo(() => buildDirectedChildCountMap(graphData.links), [graphData.links]);

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
      draggedNodeIdRef.current = null;
      userMovedNodeIdsRef.current.clear();
      userMovedNodeTargetsRef.current.clear();
      dragMemorySuppressedNodeIdsRef.current.clear();
      lastResetRequestRef.current = resetLayoutRequestId;
    }

    const visibleIds = new Set<string>();
    const nodesCopy = nodes.map((node) => {
      visibleIds.add(node.id);
      const anchorPosition = componentLayout.nodeAnchorPositions.get(node.id) ?? { x: 0, y: 0 };
      const existing = runtimeNodeMapRef.current.get(node.id);
      if (existing) {
        const shouldResetLayout = existing.__layoutVersion !== LAYOUT_VERSION;
        Object.assign(existing, node);
        existing.fx = undefined;
        existing.fy = undefined;
        seedNodePosition(existing, anchorPosition, shouldResetLayout);
        return existing;
      }

      const runtimeNode: RuntimeGraphNode = { ...node };
      seedNodePosition(runtimeNode, anchorPosition);
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

  const adjacency = useMemo(() => buildReferralGraphAdjacency(edges), [edges]);

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

  const cancelSettledFit = useCallback(() => {
    if (settledFitTimerRef.current == null) return;
    window.clearTimeout(settledFitTimerRef.current);
    settledFitTimerRef.current = null;
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
      cancelSettledFit();
      cancelPanMomentum();
    };
  }, [cancelPanMomentum, cancelPendingFit, cancelSettledFit]);

  const queueFitWhenReady = useCallback(
    (durationMs = 500, options?: { allowAfterInteraction?: boolean }) => {
      cancelPendingFit();
      cancelSettledFit();

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
          settledFitTimerRef.current = window.setTimeout(() => {
            settledFitTimerRef.current = null;
            if (viewportInteractionRef.current && !options?.allowAfterInteraction) {
              return;
            }
            fitGraph(Math.min(durationMs, 360));
          }, 1400);
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
    [cancelPendingFit, cancelSettledFit, fitGraph, graphData.nodes, height, width],
  );

  useEffect(() => {
    const fg = graphRef.current;
    if (!fg) return;

    fg.d3Force(
      'charge',
      forceManyBody<FGNode>()
        .strength(physics.chargeStrength)
        .distanceMin(physics.chargeDistanceMin)
        .distanceMax(physics.chargeDistanceMax),
    );

    const linkForce = fg.d3Force('link') as ConfigurableLinkForce | undefined;
    if (!linkForce) {
      const retryFrame = window.requestAnimationFrame(() => {
        setGraphReadyTick((value) => value + 1);
      });
      return () => window.cancelAnimationFrame(retryFrame);
    }

    const getDegreeAwareLinkStrength = (link: FGLink) => {
      const source = getRuntimeLinkEndpointId(link.source);
      const target = getRuntimeLinkEndpointId(link.target);
      const sourceDegree = graphDegreeByNodeId.get(source) ?? 1;
      const targetDegree = graphDegreeByNodeId.get(target) ?? 1;
      const baseStrength = physics.linkStrength / Math.max(1, Math.min(sourceDegree, targetDegree));
      const draggedNodeId = draggedNodeIdRef.current;
      if (!draggedNodeId) {
        return baseStrength;
      }

      return source === draggedNodeId || target === draggedNodeId ? baseStrength : baseStrength * 0.03;
    };

    linkForce.distance((link) => {
      const source = getRuntimeLinkEndpointId(link.source);
      const target = getRuntimeLinkEndpointId(link.target);
      return getReferralGraphLinkDistance(
        graphDegreeByNodeId.get(source) ?? 1,
        graphDegreeByNodeId.get(target) ?? 1,
        physics.linkDistance,
        {
          sourceHasChildren: (graphChildCountByNodeId.get(source) ?? 0) > 0,
          targetHasChildren: (graphChildCountByNodeId.get(target) ?? 0) > 0,
        },
      );
    });
    linkForce.strength(getDegreeAwareLinkStrength);
    linkForce.iterations(4);

    if (process.env.NODE_ENV === 'development') {
      const linksForDebug = graphData.links as unknown as FGLink[];
      const firstLink = linksForDebug[0];
      const linkForceAccessors = linkForce as unknown as LinkForceAccessors;
      const distanceAccessor = linkForceAccessors.distance();
      const strengthAccessor = linkForceAccessors.strength();
      const linkStrengthSamples = linksForDebug.map((link, index) => strengthAccessor(link, index, linksForDebug));
      (window as ReferralGraphDebugWindow).__referralGraphPhysicsDebug = {
        nodeCount: graphData.nodes.length,
        linkCount: graphData.links.length,
        linkDistance: firstLink ? distanceAccessor(firstLink, 0, linksForDebug) : physics.linkDistance,
        linkStrength: firstLink ? strengthAccessor(firstLink, 0, linksForDebug) : physics.linkStrength,
        minLinkStrength: linkStrengthSamples.length ? Math.min(...linkStrengthSamples) : physics.linkStrength,
        maxLinkStrength: linkStrengthSamples.length ? Math.max(...linkStrengthSamples) : physics.linkStrength,
        centerStrength: physics.centerStrength,
        chargeStrength: physics.chargeStrength,
      };
    }

    fg.d3Force('x', null);
    fg.d3Force('y', null);
    fg.d3Force(
      'link-tension',
      createReferralGraphLinkTensionForce<RuntimeGraphNode>(
        graphData.links,
        {
          activeDraggedNodeIdRef: draggedNodeIdRef,
          baseLinkDistance: physics.linkDistance,
          childCountByNodeId: graphChildCountByNodeId,
          degreeByNodeId: graphDegreeByNodeId,
          maxVelocity: 32,
          strength: 0.64,
          thresholdMultiplier: 1,
        },
      ),
    );
    fg.d3Force(
      'branch-bend',
      createReferralGraphBranchBendForce<RuntimeGraphNode>({
        childCountByNodeId: graphChildCountByNodeId,
        degreeByNodeId: graphDegreeByNodeId,
        links: graphData.links,
        maxVelocity: 16,
        strength: 0.28,
      }),
    );
    fg.d3Force(
      'sibling-angular',
      createReferralGraphSiblingAngularForce<RuntimeGraphNode>({
        links: graphData.links,
        maxVelocity: 14,
        strength: 0.34,
      }),
    );
    fg.d3Force('layout-memory', null);
    fg.d3Force(
      'node-separation',
      createReferralGraphNodeSeparationForce<RuntimeGraphNode>({
        activeDraggedNodeIdRef: draggedNodeIdRef,
        crossClusterDistance: 126,
        crossComponentDistance: 146,
        maxVelocity: 18,
        minDistance: 50,
        nodeClusterIndex: componentLayout.nodeClusterIndex,
        nodeComponentIndex: componentLayout.nodeComponentIndex,
        strength: 0.24,
      }),
    );
    fg.d3Force(
      'cluster-envelope',
      createReferralGraphComponentEnvelopeForce<RuntimeGraphNode>({
        activeDraggedNodeIdRef: draggedNodeIdRef,
        componentRadii: componentLayout.clusterRadii,
        maxVelocity: 14,
        nodeComponentIndex: componentLayout.nodeClusterIndex,
        strength: 0.1,
      }),
    );
    fg.d3Force(
      'visual-cluster-separation',
      createReferralGraphClusterSeparationForce<RuntimeGraphNode>({
        activeDraggedNodeIdRef: draggedNodeIdRef,
        clusterRadii: componentLayout.clusterRadii,
        gap: 52,
        maxVelocity: 10,
        nodeClusterIndex: componentLayout.nodeClusterIndex,
        singletonGapFactor: 0.35,
        softening: 92,
        strength: 0.04,
      }),
    );
    fg.d3Force(
      'component-separation',
      createReferralGraphClusterSeparationForce<RuntimeGraphNode>({
        activeDraggedNodeIdRef: draggedNodeIdRef,
        clusterRadii: componentLayout.componentRadii,
        gap: 92,
        maxVelocity: 16,
        nodeClusterIndex: componentLayout.nodeComponentIndex,
        softening: 92,
        strength: 0.07,
      }),
    );
    fg.d3Force(
      'cluster-gravity',
      createReferralGraphClusterGravityForce<RuntimeGraphNode>({
        activeDraggedNodeIdRef: draggedNodeIdRef,
        deadZoneRadius: 340,
        gravityScale: 120,
        maxVelocity: 4.5,
        minAlpha: 0.002,
        nodeClusterIndex: gravityNodeClusterIndex,
        singletonDeadZoneRadius: 520,
        singletonStrengthFactor: 0.6,
        softening: 210,
        strength: 0.01,
      }),
    );
    fg.d3Force(
      'component-envelope',
      createReferralGraphComponentEnvelopeForce<RuntimeGraphNode>({
        activeDraggedNodeIdRef: draggedNodeIdRef,
        componentRadii: componentLayout.componentRadii,
        maxVelocity: 16,
        nodeComponentIndex: componentLayout.nodeComponentIndex,
        strength: 0.14,
      }),
    );
    fg.d3Force('radial-containment', null);
    fg.d3Force('isolated-ring', null);
    fg.d3Force(
      'drag-spring',
      createReferralGraphDragSpringForce<RuntimeGraphNode>(
        draggedNodeIdRef,
        runtimeNodeMapRef,
        graphData.links,
        {
          baseLinkDistance: physics.linkDistance,
          childCountByNodeId: graphChildCountByNodeId,
          constraintStrength: 0.18,
          degreeByNodeId: graphDegreeByNodeId,
          maxVelocity: 90,
          preventStretch: true,
          stretchSlack: 8,
          strength: 0.9,
          velocityDamping: 0.6,
        },
      ),
    );

    fg.d3Force('center', null);
    fg.d3Force('collision', null);
    fg.d3Force('cluster-separation', null);
    fg.d3Force('cluster-repulsion', null);
    fg.d3Force('component-cohesion', null);
    fg.d3Force('cluster-cohesion', null);
    fg.d3Force('cluster-collision', null);
    fg.d3Force('component-collision', null);
    fg.d3Force('component-gravity', null);
    fg.d3Force('component-gravitation', null);
    fg.d3Force('hub-fanout', null);
    fg.d3Force('sibling-separation', null);
    fg.d3Force('drop-tether', null);
    fg.d3ReheatSimulation();
  }, [componentLayout, graphChildCountByNodeId, graphData.links, graphData.nodes, graphDegreeByNodeId, graphReadyTick, gravityNodeClusterIndex, height, physics, width]);

  useEffect(() => {
    hasFitOnceRef.current = false;
    viewportInteractionRef.current = false;
    cancelPendingFit();
    cancelSettledFit();
  }, [cancelPendingFit, cancelSettledFit, graphData.links, graphData.nodes, resetLayoutRequestId]);

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
      const linkCount = node.referralCount + node.inboundCount;
      const labelPresentation = getReferralGraphLabelPresentation({
        globalScale,
        isSelected,
        isSearchMatch,
        isHighlighted,
        linkCount,
      });
      const label = labelPresentation.showCode && node.activeCode ? `${node.name} · ${node.activeCode}` : node.name;

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
      ctx.shadowBlur = (isSelected ? 18 : isHighlighted ? 14 : 8) / Math.max(globalScale, 0.9);
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

      if (labelPresentation.visible) {
        const fontSize = Math.max(11 / Math.max(globalScale, 0.82), 8.5);
        ctx.font = `${labelPresentation.fontWeight} ${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const labelY = node.y + radius + 7 / Math.max(globalScale, 0.9);

        ctx.save();
        ctx.globalAlpha *= labelPresentation.alpha;
        ctx.shadowBlur = 5 / Math.max(globalScale, 0.9);
        ctx.shadowColor = 'rgba(255, 255, 255, 0.72)';
        ctx.lineWidth = 2.6 / Math.max(globalScale, 0.9);
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.88)';
        ctx.strokeText(label, node.x, labelY);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#1f2937';
        ctx.fillText(label, node.x, labelY);
        ctx.restore();
      }

      ctx.globalAlpha = 1;
    },
    [neighborSet, searchMatchSet, selectedNodeId],
  );

  const nodePointerAreaPaint = useCallback((rawNode: FGNode, paintColor: string, ctx: CanvasRenderingContext2D) => {
    const node = rawNode as RuntimeGraphNode;
    if (node.x == null || node.y == null) return;

    ctx.fillStyle = paintColor;
    ctx.beginPath();
    ctx.arc(node.x, node.y, getNodeRadius(node) + NODE_HIT_SLOP, 0, Math.PI * 2);
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
      const isSelectionEdge = selectedNodeId != null && (src.id === selectedNodeId || tgt.id === selectedNodeId);
      const alpha = isSelectionEdge ? 0.82 : isRelevant && isSearchRelevant ? edgeStyle.alpha : 0.08;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = isSelectionEdge ? COLORS.edgeFocused : edgeStyle.color;
      ctx.lineWidth = (isSelectionEdge ? edgeStyle.width * 1.7 : edgeStyle.width) / Math.max(globalScale, 0.72);
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
    [neighborSet, searchMatchSet, selectedNodeId],
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
    const wasDragging = nodeDragActiveRef.current;
    nodeDragActiveRef.current = true;
    draggedNodeIdRef.current = node.id;
    viewportInteractionRef.current = true;

    if (node.x != null && node.y != null) {
      node.fx = node.x;
      node.fy = node.y;
      const affectedNodeIds = getDragAffectedNodeIds(node.id, adjacency);
      for (const affectedNodeId of affectedNodeIds) {
        userMovedNodeTargetsRef.current.delete(affectedNodeId);
      }
      dragMemorySuppressedNodeIdsRef.current = new Set([
        ...userMovedNodeIdsRef.current,
        ...affectedNodeIds,
      ]);
      applyReferralGraphDragSpring(node, runtimeNodeMapRef.current, graphData.links, {
        baseLinkDistance: physics.linkDistance,
        childCountByNodeId: graphChildCountByNodeId,
        constraintStrength: 1,
        degreeByNodeId: graphDegreeByNodeId,
        maxVelocity: 90,
        preventStretch: true,
        stretchSlack: 0,
        strength: 0.9,
        velocityDamping: 0.85,
      });

      const now = Date.now();
      if (!wasDragging || now - lastDragReheatAtRef.current > 80) {
        lastDragReheatAtRef.current = now;
        graphRef.current?.d3ReheatSimulation();
      }
    }
  }, [adjacency, cancelPanMomentum, graphChildCountByNodeId, graphData.links, graphDegreeByNodeId, physics.linkDistance]);

  const handleNodeDragEnd = useCallback((rawNode: FGNode) => {
    const node = rawNode as RuntimeGraphNode;
    if (node.x != null && node.y != null) {
      node.fx = undefined;
      node.fy = undefined;
      graphRef.current?.d3ReheatSimulation();
    }

    nodeDragActiveRef.current = false;
    draggedNodeIdRef.current = null;
    const affectedNodeIds = getDragAffectedNodeIds(node.id, adjacency);
    for (const affectedNodeId of affectedNodeIds) {
      userMovedNodeIdsRef.current.add(affectedNodeId);
      userMovedNodeTargetsRef.current.delete(affectedNodeId);
    }
    if (node.x != null && node.y != null) {
      userMovedNodeTargetsRef.current.set(node.id, {
        x: node.x,
        y: node.y,
      });
    }
    dragMemorySuppressedNodeIdsRef.current = new Set(userMovedNodeIdsRef.current);
    suppressClickUntilRef.current = Date.now() + 500;

    const container = containerRef.current;
    if (container instanceof HTMLDivElement) {
      container.style.cursor = 'grab';
    }
  }, [adjacency]);

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
        d3AlphaMin={0}
        d3AlphaDecay={physics.alphaDecay}
        d3VelocityDecay={physics.velocityDecay}
        cooldownTicks={Infinity}
        cooldownTime={Infinity}
      />
    </div>
  );
}
