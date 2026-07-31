import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';

import {
  buildSampleRevenueGraphLayout,
  formatCompactSampleRevenueKrw,
  formatSampleRevenueNodeAmount,
  getSampleRevenueGraphRadialTargetRadius,
  getSampleRevenueGraphNodeColor,
  getSampleRevenueGraphNodeRadius,
  getSampleRevenueGraphNodeStatusLabel,
  prepareSampleRevenueGraphPhysicsTopology,
  SAMPLE_REVENUE_ADMIN_WEB_PHYSICS,
  SAMPLE_REVENUE_GRAPH_GUIDE_DEPTHS,
  SAMPLE_REVENUE_GRAPH_MAX_SCALE,
  SAMPLE_REVENUE_GRAPH_MIN_SCALE,
  SAMPLE_REVENUE_GRAPH_SURFACE_SIZE,
  SAMPLE_REVENUE_MOBILE_SETTLE,
  SAMPLE_REVENUE_RADIAL_GUIDANCE,
} from '@/lib/referral-revenue-graph-native';
import type {
  SampleRevenueGraphEdge,
  SampleRevenueGraphNode,
} from '@/types/referral-revenue-graph';

type Props = {
  nodes: SampleRevenueGraphNode[];
  edges: SampleRevenueGraphEdge[];
  expectedTotalKrw: number;
  focusedNodeIds?: ReadonlySet<string>;
  selectedNodeId: string | null;
  onSelectNode: (node: SampleRevenueGraphNode) => void;
  fitRequestId: number;
  resetRequestId: number;
  fitInsets?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
  overlayBottomInset?: number;
};

type CanvasNode = {
  id: string;
  name: string;
  compactLabel: string;
  nodeAmountLabel: string;
  selectedAmountLabel: string;
  statusLabel: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  collisionRadius: number;
  fill: string;
  labelColor: string;
  eligible: boolean;
  viewer: boolean;
  context: boolean;
  depth: number;
  radialOffsetX: number;
  radialOffsetY: number;
  radialRadius: number;
};

type CanvasEdge = {
  sourceIndex: number;
  targetIndex: number;
  distance: number;
  strength: number;
  stroke: string;
  dashed: boolean;
  context: boolean;
  revenueEligible: boolean;
};

type CanvasRing = {
  depth: number;
  radius: number;
};

const escapeInlineJson = (value: unknown) => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

let nextBridgeRevision = 0;

const createBridgeRevision = () => {
  nextBridgeRevision += 1;
  return `referral-revenue-canvas-${nextBridgeRevision}`;
};

const buildCanvasHtml = ({
  bridgeRevision,
  canvasEdges,
  canvasNodes,
  canvasRings,
  fitInsets,
  overlayBottomInset,
}: {
  bridgeRevision: string;
  canvasEdges: CanvasEdge[];
  canvasNodes: CanvasNode[];
  canvasRings: CanvasRing[];
  fitInsets: Props['fitInsets'];
  overlayBottomInset: number;
}) => {
  const payload = escapeInlineJson({
    bridgeRevision,
    nodes: canvasNodes,
    edges: canvasEdges,
    rings: canvasRings,
    selectedNodeId: null,
    fitInsets: {
      top: fitInsets?.top ?? 0,
      right: fitInsets?.right ?? 0,
      bottom: fitInsets?.bottom ?? 0,
      left: fitInsets?.left ?? 0,
    },
    overlayBottomInset,
    surfaceSize: SAMPLE_REVENUE_GRAPH_SURFACE_SIZE,
    minScale: SAMPLE_REVENUE_GRAPH_MIN_SCALE,
    maxScale: SAMPLE_REVENUE_GRAPH_MAX_SCALE,
    physics: SAMPLE_REVENUE_ADMIN_WEB_PHYSICS,
    settle: SAMPLE_REVENUE_MOBILE_SETTLE,
    radialGuidance: SAMPLE_REVENUE_RADIAL_GUIDANCE,
  });

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; base-uri 'none'; form-action 'none'; navigate-to 'none'" />
  <style>
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #fffaf5; }
    body { overscroll-behavior: none; touch-action: none; -webkit-user-select: none; user-select: none; }
    canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    .sr-only { position: fixed; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  </style>
</head>
<body>
  <canvas id="graph" role="img" aria-label="샘플 매출 기여 노드 엣지 그래프. 주황 화살표는 하위 구성원에서 부모와 나를 향하는 샘플 기여 계산 방향입니다. 빈 공간은 한 손가락으로 이동하고, 노드는 끌어서 움직이며, 두 손가락으로 확대하거나 축소할 수 있습니다."></canvas>
  <div id="accessibleNodes" class="sr-only"></div>
  <script>
  (() => {
    'use strict';
    const config = ${payload};
    const canvas = document.getElementById('graph');
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    const initialNodes = config.nodes.map((node) => ({ ...node }));
    const nodes = config.nodes.map((node) => ({ ...node }));
    const edges = config.edges;
    const rings = config.rings;
    const center = config.surfaceSize / 2;
    const physics = config.physics;
    // Intentionally shorter than admin d3AlphaDecay: mobile bounds the
    // post-drag work so the WebView reaches an idle RAF state quickly.
    const settle = config.settle;
    const radialGuidance = config.radialGuidance;
    const viewerIndex = nodes.findIndex((node) => node.viewer);
    const nodeIndexById = new Map(nodes.map((node, index) => [node.id, index]));
    const parentEdgeByChildIndex = new Map(
      edges.map((edge, edgeIndex) => [edge.targetIndex, edgeIndex]),
    );
    const prefersReducedMotion = Boolean(
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
    );
    const pointers = new Map();
    const view = { scale: 1, panX: 0, panY: 0 };
    let width = 1;
    let height = 1;
    let pixelRatio = 1;
    let selectedNodeId = config.selectedNodeId;
    let dragIndex = -1;
    let dragPointerId = null;
    let dragMoved = false;
    let dragStartScreen = null;
    let pendingDragPosition = null;
    let panPointerId = null;
    let panStart = null;
    let pinch = null;
    let activePhysics = false;
    let settleAlpha = 0;
    let dirty = true;
    let zoomBadgeUntil = 0;
    let frameRequestId = null;
    let runtimeEnabled = true;
    let selectedPathEdgeIndexes = [];
    let selectedPathEdgeSet = new Set();
    let flowPulseStartedAt = 0;
    let flowPulseUntil = 0;
    const dragActivationDistance = 6;
    const flowPulseMaxDuration = 1500;

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const finitePositiveScale = (value) => (
      Number.isFinite(value) && value > 0 ? value : Number.EPSILON
    );
    const graphToScreenX = (x) => width / 2 + view.panX + (x - center) * view.scale;
    const graphToScreenY = (y) => height / 2 + view.panY + (y - center) * view.scale;
    const screenToGraph = (x, y) => {
      const currentScale = finitePositiveScale(view.scale);
      return {
        x: center + (x - width / 2 - view.panX) / currentScale,
        y: center + (y - height / 2 - view.panY) / currentScale,
      };
    };
    const createTextCache = (cacheWidth, cacheHeight, drawText) => {
      const cache = document.createElement('canvas');
      const cacheRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      cache.width = Math.round(cacheWidth * cacheRatio);
      cache.height = Math.round(cacheHeight * cacheRatio);
      const cacheContext = cache.getContext('2d');
      cacheContext.setTransform(cacheRatio, 0, 0, cacheRatio, 0, 0);
      cacheContext.textAlign = 'center';
      cacheContext.textBaseline = 'middle';
      drawText(cacheContext, cacheWidth, cacheHeight);
      return cache;
    };
    const nodeLabelCaches = nodes.map((node) => createTextCache(
      90,
      30,
      (cacheContext, cacheWidth) => {
        cacheContext.fillStyle = node.labelColor;
        cacheContext.font = '800 11px system-ui, sans-serif';
        cacheContext.fillText(node.compactLabel, cacheWidth / 2, 10);
        cacheContext.font = '800 7px system-ui, sans-serif';
        cacheContext.fillText(node.nodeAmountLabel, cacheWidth / 2, 21);
      },
    ));
    const selectedLabelCaches = nodes.map((node) => createTextCache(
      228,
      38,
      (cacheContext, cacheWidth) => {
        cacheContext.fillStyle = '#334155';
        cacheContext.font = '800 11px system-ui, sans-serif';
        cacheContext.fillText(node.name, cacheWidth / 2, 10);
        cacheContext.fillStyle = node.eligible && !node.context
          ? '#c2410c'
          : '#64748b';
        cacheContext.font = '700 9px system-ui, sans-serif';
        cacheContext.fillText(node.selectedAmountLabel, cacheWidth / 2, 26);
      },
    ));

    const roundedRect = (x, y, w, h, radius) => {
      const r = Math.min(radius, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    };

    const rebuildSelectedPath = () => {
      selectedPathEdgeIndexes = [];
      const selectedIndex = typeof selectedNodeId === 'string'
        ? nodeIndexById.get(selectedNodeId)
        : undefined;
      if (
        selectedIndex == null
        || !nodes[selectedIndex]
        || !nodes[selectedIndex].eligible
      ) {
        selectedPathEdgeSet = new Set();
        return;
      }

      const seen = new Set();
      let childIndex = selectedIndex;
      while (childIndex !== viewerIndex && !seen.has(childIndex)) {
        seen.add(childIndex);
        const edgeIndex = parentEdgeByChildIndex.get(childIndex);
        if (edgeIndex == null) {
          selectedPathEdgeIndexes = [];
          break;
        }
        const edge = edges[edgeIndex];
        if (!edge?.revenueEligible) {
          selectedPathEdgeIndexes = [];
          break;
        }
        selectedPathEdgeIndexes.push(edgeIndex);
        childIndex = edge.sourceIndex;
      }
      if (childIndex !== viewerIndex) {
        selectedPathEdgeIndexes = [];
      }
      selectedPathEdgeSet = new Set(selectedPathEdgeIndexes);
    };

    const selectNode = (nodeId, animate) => {
      const nextId = typeof nodeId === 'string' && nodeIndexById.has(nodeId)
        ? nodeId
        : null;
      const changed = nextId !== selectedNodeId;
      selectedNodeId = nextId;
      rebuildSelectedPath();
      if (
        changed
        && animate
        && !prefersReducedMotion
        && selectedPathEdgeIndexes.length > 0
      ) {
        const now = performance.now();
        flowPulseStartedAt = now;
        flowPulseUntil = now + Math.min(
          flowPulseMaxDuration,
          500 + selectedPathEdgeIndexes.length * 90,
        );
      } else if (
        changed
        || !nextId
        || prefersReducedMotion
      ) {
        flowPulseStartedAt = 0;
        flowPulseUntil = 0;
      }
      dirty = true;
      requestLoop();
    };

    const fit = () => {
      if (!nodes.length || width <= 1 || height <= 1) return;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const node of nodes) {
        minX = Math.min(minX, node.x - node.radius);
        maxX = Math.max(maxX, node.x + node.radius);
        minY = Math.min(minY, node.y - node.radius);
        maxY = Math.max(maxY, node.y + node.radius);
      }
      const insets = config.fitInsets;
      const padding = 52;
      const usableWidth = Math.max(1, width - insets.left - insets.right - padding * 2);
      const usableHeight = Math.max(1, height - insets.top - insets.bottom - padding * 2);
      const viewer = nodes[viewerIndex];
      const graphCenterX = viewer?.x ?? (minX + maxX) / 2;
      const graphCenterY = viewer?.y ?? (minY + maxY) / 2;
      const spanX = Math.max(
        1,
        Math.max(maxX - graphCenterX, graphCenterX - minX) * 2,
      );
      const spanY = Math.max(
        1,
        Math.max(maxY - graphCenterY, graphCenterY - minY) * 2,
      );
      view.scale = Math.max(
        Number.EPSILON,
        Math.min(usableWidth / spanX, usableHeight / spanY, config.maxScale),
      );
      const viewportCenterX = insets.left + (width - insets.left - insets.right) / 2;
      const viewportCenterY = insets.top + (height - insets.top - insets.bottom) / 2;
      view.panX = viewportCenterX - width / 2 - (graphCenterX - center) * view.scale;
      view.panY = viewportCenterY - height / 2 - (graphCenterY - center) * view.scale;
      dirty = true;
      requestLoop();
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      fit();
    };

    const deterministicUnit = (leftId, rightId) => {
      const key = leftId + ':' + rightId;
      let hash = 2166136261;
      for (let index = 0; index < key.length; index += 1) {
        hash ^= key.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      const angle = ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
      return { x: Math.cos(angle), y: Math.sin(angle) };
    };

    const addBoundedGuidanceImpulse = (
      node,
      deltaX,
      deltaY,
      strength,
      maximumImpulse,
      alpha,
    ) => {
      const rawImpulseX = deltaX * strength * alpha;
      const rawImpulseY = deltaY * strength * alpha;
      const rawMagnitude = Math.hypot(rawImpulseX, rawImpulseY);
      const impulseScale = rawMagnitude > maximumImpulse
        ? maximumImpulse / rawMagnitude
        : 1;
      node.vx += rawImpulseX * impulseScale;
      node.vy += rawImpulseY * impulseScale;
    };

    const stepPhysics = (alpha, fixedIndex, fixedPosition) => {
      if (fixedIndex >= 0 && fixedPosition) {
        const fixedNode = nodes[fixedIndex];
        if (fixedNode) {
          fixedNode.x = fixedPosition.x;
          fixedNode.y = fixedPosition.y;
          fixedNode.vx = 0;
          fixedNode.vy = 0;
        }
      }
      const viewer = nodes[viewerIndex];
      for (let index = 0; index < nodes.length; index += 1) {
        if (index === fixedIndex) continue;
        const node = nodes[index];
        if (index === viewerIndex) {
          addBoundedGuidanceImpulse(
            node,
            center - node.x,
            center - node.y,
            radialGuidance.viewerAnchorStrength,
            radialGuidance.viewerAnchorMaxImpulse,
            alpha,
          );
          continue;
        }
        const targetX = (viewer?.x ?? center) + node.radialOffsetX;
        const targetY = (viewer?.y ?? center) + node.radialOffsetY;
        addBoundedGuidanceImpulse(
          node,
          targetX - node.x,
          targetY - node.y,
          radialGuidance.targetStrength,
          radialGuidance.targetMaxImpulse,
          alpha,
        );
      }

      for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
          const left = nodes[leftIndex];
          const right = nodes[rightIndex];
          let dx = right.x - left.x;
          let dy = right.y - left.y;
          let distance = Math.hypot(dx, dy);
          if (distance < 0.001) {
            const unit = deterministicUnit(left.id, right.id);
            dx = unit.x;
            dy = unit.y;
            distance = 1;
          }
          if (distance > physics.chargeDistanceMax) continue;
          const effectiveDistance = Math.max(distance, physics.chargeDistanceMin);
          const impulse = Math.abs(physics.chargeStrength)
            * alpha / (effectiveDistance * effectiveDistance);
          const forceX = dx * impulse;
          const forceY = dy * impulse;
          if (leftIndex !== fixedIndex) {
            left.vx -= forceX;
            left.vy -= forceY;
          }
          if (rightIndex !== fixedIndex) {
            right.vx += forceX;
            right.vy += forceY;
          }
        }
      }

      for (let iteration = 0; iteration < 2; iteration += 1) {
        for (const edge of edges) {
          const source = nodes[edge.sourceIndex];
          const target = nodes[edge.targetIndex];
          let dx = (target.x + target.vx) - (source.x + source.vx);
          let dy = (target.y + target.vy) - (source.y + source.vy);
          let distance = Math.hypot(dx, dy);
          if (distance < 0.001) {
            const unit = deterministicUnit(source.id, target.id);
            dx = unit.x;
            dy = unit.y;
            distance = 1;
          }
          let spring = (distance - edge.distance)
            / distance * alpha * edge.strength;
          if (distance > edge.distance * physics.linkTensionThresholdMultiplier) {
            spring += (distance - edge.distance)
              / distance * alpha * physics.linkTensionStrength;
          }
          const forceX = dx * spring * 0.5;
          const forceY = dy * spring * 0.5;
          if (edge.sourceIndex !== fixedIndex) {
            source.vx += forceX;
            source.vy += forceY;
          }
          if (edge.targetIndex !== fixedIndex) {
            target.vx -= forceX;
            target.vy -= forceY;
          }
        }
      }

      for (let iteration = 0; iteration < physics.collisionIterations; iteration += 1) {
        for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
            const left = nodes[leftIndex];
            const right = nodes[rightIndex];
            let dx = (right.x + right.vx) - (left.x + left.vx);
            let dy = (right.y + right.vy) - (left.y + left.vy);
            let distance = Math.hypot(dx, dy);
            if (distance < 0.001) {
              const unit = deterministicUnit(left.id, right.id);
              dx = unit.x;
              dy = unit.y;
              distance = 1;
            }
            const minimumDistance = left.collisionRadius + right.collisionRadius + 5;
            if (distance >= minimumDistance) continue;
            const collision = (minimumDistance - distance)
              / distance * physics.collisionStrength * 0.5;
            const forceX = dx * collision;
            const forceY = dy * collision;
            if (leftIndex !== fixedIndex) {
              left.vx -= forceX;
              left.vy -= forceY;
            }
            if (rightIndex !== fixedIndex) {
              right.vx += forceX;
              right.vy += forceY;
            }
          }
        }
      }

      const velocityRetention = 1 - physics.velocityDecay;
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (index === fixedIndex && fixedPosition) {
          node.x = fixedPosition.x;
          node.y = fixedPosition.y;
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        node.vx *= velocityRetention;
        node.vy *= velocityRetention;
        const nextX = node.x + node.vx;
        const nextY = node.y + node.vy;
        if (Number.isFinite(nextX)) {
          node.x = nextX;
        } else {
          node.vx = 0;
        }
        if (Number.isFinite(nextY)) {
          node.y = nextY;
        } else {
          node.vy = 0;
        }
      }
      if (fixedIndex < 0 && viewer) {
        const rawOffsetX = (center - viewer.x)
          * radialGuidance.viewerAnchorStrength;
        const rawOffsetY = (center - viewer.y)
          * radialGuidance.viewerAnchorStrength;
        const rawMagnitude = Math.hypot(rawOffsetX, rawOffsetY);
        const rebaseScale = rawMagnitude
          > radialGuidance.viewerAnchorMaxImpulse
          ? radialGuidance.viewerAnchorMaxImpulse / rawMagnitude
          : 1;
        const offsetX = rawOffsetX * rebaseScale;
        const offsetY = rawOffsetY * rebaseScale;
        for (const node of nodes) {
          node.x += offsetX;
          node.y += offsetY;
        }
      }
    };

    const getEdgeGeometry = (edge) => {
      const parent = nodes[edge.sourceIndex];
      const child = nodes[edge.targetIndex];
      if (!parent || !child) return null;
      const parentX = graphToScreenX(parent.x);
      const parentY = graphToScreenY(parent.y);
      const childX = graphToScreenX(child.x);
      const childY = graphToScreenY(child.y);
      const dx = parentX - childX;
      const dy = parentY - childY;
      const distance = Math.hypot(dx, dy);
      if (distance < 1) return null;
      const unitX = dx / distance;
      const unitY = dy / distance;
      const parentRadius = Math.max(14, parent.radius * view.scale);
      const childRadius = Math.max(14, child.radius * view.scale);
      const availableGap = distance - parentRadius - childRadius;
      if (availableGap < 2) return null;
      const endpointGap = Math.min(
        2,
        Math.max(0.5, availableGap * 0.08),
      );
      const startX = childX + unitX * (childRadius + endpointGap);
      const startY = childY + unitY * (childRadius + endpointGap);
      const tipX = parentX - unitX * (parentRadius + endpointGap);
      const tipY = parentY - unitY * (parentRadius + endpointGap);
      const usableLength = Math.hypot(tipX - startX, tipY - startY);
      if (usableLength < 2) return null;
      const headLength = Math.min(9, Math.max(2.5, usableLength * 0.7));
      const headWidth = Math.max(1.75, headLength * 0.5);
      const baseX = tipX - unitX * headLength;
      const baseY = tipY - unitY * headLength;
      return {
        startX,
        startY,
        tipX,
        tipY,
        baseX,
        baseY,
        unitX,
        unitY,
        headWidth,
      };
    };

    const drawContributionArrow = (geometry, selected, context) => {
      const color = selected ? '#ea580c' : '#f97316';
      ctx.save();
      ctx.globalAlpha = selected ? 1 : context ? 0.42 : 0.78;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = selected ? 2.7 : 1.55;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(geometry.startX, geometry.startY);
      ctx.lineTo(geometry.baseX, geometry.baseY);
      ctx.stroke();
      const perpendicularX = -geometry.unitY;
      const perpendicularY = geometry.unitX;
      ctx.beginPath();
      ctx.moveTo(geometry.tipX, geometry.tipY);
      ctx.lineTo(
        geometry.baseX + perpendicularX * geometry.headWidth,
        geometry.baseY + perpendicularY * geometry.headWidth,
      );
      ctx.lineTo(
        geometry.baseX - perpendicularX * geometry.headWidth,
        geometry.baseY - perpendicularY * geometry.headWidth,
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    const draw = (now) => {
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.fillStyle = '#fffaf5';
      ctx.fillRect(0, 0, width, height);
      ctx.lineCap = 'round';

      const viewer = nodes[viewerIndex];
      if (viewer) {
        const viewerX = graphToScreenX(viewer.x);
        const viewerY = graphToScreenY(viewer.y);
        for (const ring of rings) {
          const screenRadius = ring.radius * view.scale;
          if (screenRadius < 18) continue;
          ctx.save();
          ctx.beginPath();
          ctx.arc(viewerX, viewerY, screenRadius, 0, Math.PI * 2);
          ctx.strokeStyle = ring.depth === 10
            ? 'rgba(249,115,22,0.18)'
            : 'rgba(148,163,184,0.16)';
          ctx.lineWidth = 1;
          ctx.setLineDash(ring.depth === 10 ? [4, 5] : [2, 6]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(100,116,139,0.62)';
          ctx.font = '700 8px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            ring.depth + '단계',
            viewerX + screenRadius * 0.71,
            viewerY - screenRadius * 0.71,
          );
          ctx.restore();
        }
      }

      for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
        const edge = edges[edgeIndex];
        if (!edge.revenueEligible) {
          const source = nodes[edge.sourceIndex];
          const target = nodes[edge.targetIndex];
          ctx.beginPath();
          ctx.moveTo(graphToScreenX(source.x), graphToScreenY(source.y));
          ctx.lineTo(graphToScreenX(target.x), graphToScreenY(target.y));
          ctx.strokeStyle = edge.stroke;
          ctx.lineWidth = 1.5;
          ctx.setLineDash(edge.dashed ? [5, 5] : []);
          ctx.stroke();
          continue;
        }
        const geometry = getEdgeGeometry(edge);
        if (geometry) {
          drawContributionArrow(
            geometry,
            selectedPathEdgeSet.has(edgeIndex),
            edge.context,
          );
        }
      }
      ctx.setLineDash([]);

      if (now < flowPulseUntil && selectedPathEdgeIndexes.length > 0) {
        const elapsed = now - flowPulseStartedAt;
        selectedPathEdgeIndexes.forEach((edgeIndex, pathIndex) => {
          const edge = edges[edgeIndex];
          const geometry = edge ? getEdgeGeometry(edge) : null;
          if (!geometry) return;
          const delayed = elapsed - pathIndex * 70;
          if (delayed < 0) return;
          const progress = (delayed % 520) / 520;
          const pulseX = geometry.startX
            + (geometry.tipX - geometry.startX) * progress;
          const pulseY = geometry.startY
            + (geometry.tipY - geometry.startY) * progress;
          ctx.save();
          ctx.shadowColor = 'rgba(249,115,22,0.75)';
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(pulseX, pulseY, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff7ed';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = '#ea580c';
          ctx.stroke();
          ctx.restore();
        });
      }

      for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
        const node = nodes[nodeIndex];
        const x = graphToScreenX(node.x);
        const y = graphToScreenY(node.y);
        const radius = Math.max(14, node.radius * view.scale);
        if (node.id === selectedNodeId) {
          ctx.beginPath();
          ctx.arc(x, y, radius + 7, 0, Math.PI * 2);
          ctx.strokeStyle = '#2563eb';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = node.fill;
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.4;
        ctx.setLineDash(!node.eligible && !node.viewer ? [5, 5] : []);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.drawImage(nodeLabelCaches[nodeIndex], x - 45, y - 15, 90, 30);

        if (node.id === selectedNodeId) {
          ctx.drawImage(
            selectedLabelCaches[nodeIndex],
            x - 114,
            y + radius + 7,
            228,
            38,
          );
        }
      }

      if (activePhysics || settleAlpha > settle.stopThreshold) {
        const label = '물리 반응 중';
        ctx.font = '800 10px system-ui, sans-serif';
        const badgeWidth = ctx.measureText(label).width + 34;
        const badgeY = height - config.overlayBottomInset - 31;
        roundedRect(12, badgeY, badgeWidth, 27, 14);
        ctx.fillStyle = 'rgba(124,45,18,0.88)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(24, badgeY + 13.5, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#fde68a';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 34, badgeY + 13.5);
      }

      if (now < zoomBadgeUntil) {
        const label = Math.round(view.scale * 100) + '%';
        ctx.font = '800 11px system-ui, sans-serif';
        const badgeWidth = ctx.measureText(label).width + 18;
        const badgeX = width - badgeWidth - 12;
        const badgeY = height - config.overlayBottomInset - 29;
        roundedRect(badgeX, badgeY, badgeWidth, 25, 13);
        ctx.fillStyle = 'rgba(124,45,18,0.78)';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, badgeX + badgeWidth / 2, badgeY + 12.5);
      }
    };

    const requestLoop = () => {
      if (!runtimeEnabled || frameRequestId != null) return;
      frameRequestId = requestAnimationFrame(loop);
    };

    const loop = (now) => {
      frameRequestId = null;
      if (!runtimeEnabled) return;
      if (activePhysics && dragIndex >= 0 && pendingDragPosition) {
        stepPhysics(0.24, dragIndex, pendingDragPosition);
        dirty = true;
      } else if (settleAlpha > settle.stopThreshold) {
        settleAlpha *= settle.decayMultiplier;
        stepPhysics(settleAlpha, -1, null);
        dirty = true;
      } else if (settleAlpha !== 0) {
        settleAlpha = 0;
        dirty = true;
      }

      const zoomBadgeVisible = now < zoomBadgeUntil;
      if (!zoomBadgeVisible && zoomBadgeUntil !== 0) {
        zoomBadgeUntil = 0;
        dirty = true;
      }
      const flowPulseVisible = now < flowPulseUntil;
      if (!flowPulseVisible && flowPulseUntil !== 0) {
        flowPulseUntil = 0;
        flowPulseStartedAt = 0;
        dirty = true;
      }
      if (dirty || zoomBadgeVisible || flowPulseVisible) {
        draw(now);
        dirty = false;
      }
      if (
        activePhysics
        || settleAlpha > 0
        || zoomBadgeVisible
        || flowPulseVisible
      ) {
        requestLoop();
      }
    };

    const nearestNode = (screenX, screenY) => {
      let nearest = -1;
      let nearestDistance = Infinity;
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const dx = graphToScreenX(node.x) - screenX;
        const dy = graphToScreenY(node.y) - screenY;
        const distance = Math.hypot(dx, dy);
        const hitRadius = Math.max(30, node.radius * view.scale);
        if (distance <= hitRadius && distance < nearestDistance) {
          nearest = index;
          nearestDistance = distance;
        }
      }
      return nearest;
    };

    const beginPinch = () => {
      if (pointers.size < 2) return;
      const [first, second] = Array.from(pointers.values());
      const focalX = (first.x + second.x) / 2;
      const focalY = (first.y + second.y) / 2;
      pinch = {
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
        scale: finitePositiveScale(view.scale),
        minScale: Math.min(
          config.minScale,
          finitePositiveScale(view.scale),
        ),
        graphAtFocal: screenToGraph(focalX, focalY),
      };
      activePhysics = false;
      dragIndex = -1;
      dragPointerId = null;
      panPointerId = null;
      pendingDragPosition = null;
      dragStartScreen = null;
      dragMoved = false;
    };

    const updatePinch = () => {
      if (!pinch || pointers.size < 2) return;
      const [first, second] = Array.from(pointers.values());
      const focalX = (first.x + second.x) / 2;
      const focalY = (first.y + second.y) / 2;
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
      view.scale = clamp(
        pinch.scale * distance / pinch.distance,
        pinch.minScale,
        config.maxScale,
      );
      view.panX = focalX - width / 2 - (pinch.graphAtFocal.x - center) * view.scale;
      view.panY = focalY - height / 2 - (pinch.graphAtFocal.y - center) * view.scale;
      zoomBadgeUntil = performance.now() + 1400;
      dirty = true;
      requestLoop();
    };

    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        beginPinch();
        return;
      }
      const hitIndex = nearestNode(event.clientX, event.clientY);
      dragStartScreen = { x: event.clientX, y: event.clientY };
      dragMoved = false;
      if (hitIndex >= 0) {
        dragIndex = hitIndex;
        dragPointerId = event.pointerId;
        pendingDragPosition = null;
        activePhysics = false;
        settleAlpha = 0;
      } else {
        panPointerId = event.pointerId;
        panStart = {
          x: event.clientX,
          y: event.clientY,
          panX: view.panX,
          panY: view.panY,
        };
      }
      dirty = true;
      requestLoop();
    }, { passive: false });

    canvas.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        updatePinch();
        return;
      }
      if (event.pointerId === dragPointerId && dragIndex >= 0) {
        const movedDistance = dragStartScreen
          ? Math.hypot(
            event.clientX - dragStartScreen.x,
            event.clientY - dragStartScreen.y,
          )
          : 0;
        if (!dragMoved && movedDistance > dragActivationDistance) {
          dragMoved = true;
          activePhysics = true;
        }
        if (dragMoved) {
          pendingDragPosition = screenToGraph(event.clientX, event.clientY);
          dirty = true;
          requestLoop();
        }
      } else if (event.pointerId === panPointerId && panStart) {
        view.panX = panStart.panX + event.clientX - panStart.x;
        view.panY = panStart.panY + event.clientY - panStart.y;
        dirty = true;
        requestLoop();
      }
    }, { passive: false });

    const finishPointer = (event, cancelled) => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      const releasedDragIndex = event.pointerId === dragPointerId ? dragIndex : -1;
      pointers.delete(event.pointerId);
      if (pinch) {
        pinch = null;
        zoomBadgeUntil = performance.now() + 1400;
        if (pointers.size === 1) {
          const [remainingId, remaining] = Array.from(pointers.entries())[0];
          panPointerId = remainingId;
          panStart = {
            x: remaining.x,
            y: remaining.y,
            panX: view.panX,
            panY: view.panY,
          };
        }
      }
      if (releasedDragIndex >= 0) {
        if (!cancelled && dragMoved) {
          pendingDragPosition = screenToGraph(event.clientX, event.clientY);
          stepPhysics(0.24, releasedDragIndex, pendingDragPosition);
        }
        if (!cancelled && !dragMoved) {
          const node = nodes[releasedDragIndex];
          if (!node.viewer && !node.context) {
            selectNode(node.id, true);
            window.ReactNativeWebView?.postMessage(JSON.stringify({
              type: 'select-node',
              nodeId: node.id,
              bridgeRevision: config.bridgeRevision,
              documentUrl: window.location.href,
            }));
          }
        }
        activePhysics = false;
        settleAlpha = !cancelled && dragMoved ? settle.initialAlpha : 0;
        dragIndex = -1;
        dragPointerId = null;
        pendingDragPosition = null;
      }
      if (event.pointerId === panPointerId) {
        panPointerId = null;
        panStart = null;
      }
      dragStartScreen = null;
      dragMoved = false;
      dirty = true;
      requestLoop();
    };

    canvas.addEventListener(
      'pointerup',
      (event) => finishPointer(event, false),
      { passive: false },
    );
    canvas.addEventListener(
      'pointercancel',
      (event) => finishPointer(event, true),
      { passive: false },
    );
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    const accessibleNodes = document.getElementById('accessibleNodes');
    for (const node of nodes) {
      if (node.viewer || node.context) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = node.name;
      button.setAttribute(
        'aria-label',
        node.name + ', ' + node.statusLabel + '. 두 번 탭하면 샘플 매출과 예상 배분 상세를 엽니다.',
      );
      button.addEventListener('click', () => {
        selectNode(node.id, true);
        window.ReactNativeWebView?.postMessage(JSON.stringify({
          type: 'select-node',
          nodeId: node.id,
          bridgeRevision: config.bridgeRevision,
          documentUrl: window.location.href,
        }));
      });
      accessibleNodes.appendChild(button);
    }

    window.__revenueGraph = {
      fit: () => fit(),
      reset: () => {
        for (let index = 0; index < nodes.length; index += 1) {
          Object.assign(nodes[index], initialNodes[index]);
        }
        activePhysics = false;
        settleAlpha = 0;
        flowPulseStartedAt = 0;
        flowPulseUntil = 0;
        selectNode(null, false);
        fit();
      },
      select: (nodeId) => {
        selectNode(nodeId, true);
      },
      zoomTo: (nextScale) => {
        view.scale = clamp(
          Number(nextScale) || view.scale,
          config.minScale,
          config.maxScale,
        );
        zoomBadgeUntil = performance.now() + 1400;
        dirty = true;
        requestLoop();
      },
      setActive: (nextActive) => {
        runtimeEnabled = Boolean(nextActive);
        if (!runtimeEnabled) {
          if (frameRequestId != null) {
            cancelAnimationFrame(frameRequestId);
            frameRequestId = null;
          }
          pointers.clear();
          activePhysics = false;
          settleAlpha = 0;
          flowPulseStartedAt = 0;
          flowPulseUntil = 0;
          dragIndex = -1;
          dragPointerId = null;
          pendingDragPosition = null;
          panPointerId = null;
          panStart = null;
          pinch = null;
          return;
        }
        dirty = true;
        requestLoop();
      },
    };

    window.addEventListener('resize', resize);
    resize();
    requestLoop();
  })();
  </script>
</body>
</html>`;
};

export function ReferralRevenueGraphWebViewCanvas({
  nodes,
  edges,
  expectedTotalKrw,
  focusedNodeIds,
  selectedNodeId,
  onSelectNode,
  fitRequestId,
  resetRequestId,
  fitInsets,
  overlayBottomInset = 12,
}: Props) {
  const webViewRef = useRef<WebView>(null);
  const isFocused = useIsFocused();
  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const topology = useMemo(
    () => prepareSampleRevenueGraphPhysicsTopology(nodes, edges),
    [edges, nodes],
  );
  const initialPositions = useMemo(
    () => buildSampleRevenueGraphLayout(nodes, edges, topology),
    [edges, nodes, topology],
  );
  const nodeIndexById = useMemo(
    () => new Map(topology.nodes.map(({ node }, index) => [node.id, index])),
    [topology],
  );
  const canvasNodes = useMemo<CanvasNode[]>(() => (
    topology.nodes.map(({ node, collisionRadius, radialTarget }) => {
      const point = initialPositions.get(node.id)
        ?? {
          x: SAMPLE_REVENUE_GRAPH_SURFACE_SIZE / 2,
          y: SAMPLE_REVENUE_GRAPH_SURFACE_SIZE / 2,
        };
      const context = Boolean(
        focusedNodeIds && !focusedNodeIds.has(node.id),
      );
      const withoutSamplePrefix = node.name.replace(/^샘플\s+/u, '').trim();
      return {
        id: node.id,
        name: node.name,
        compactLabel: node.isViewer
          ? '나'
          : withoutSamplePrefix.length <= 3
            ? withoutSamplePrefix
            : `${withoutSamplePrefix.slice(0, 2)}…`,
        nodeAmountLabel: node.isViewer
          ? `+${formatSampleRevenueNodeAmount(expectedTotalKrw)}`
          : node.eligible
            ? formatSampleRevenueNodeAmount(node.expectedAllocationKrw)
            : '제외',
        selectedAmountLabel: node.isViewer
          ? `예상 유입 합계 +${formatCompactSampleRevenueKrw(expectedTotalKrw)}`
          : node.eligible
            ? `매출 ${formatCompactSampleRevenueKrw(node.salesKrw)} → 내 예상 ${formatCompactSampleRevenueKrw(node.expectedAllocationKrw)}`
            : `매출 ${formatCompactSampleRevenueKrw(node.salesKrw)} · 대상 제외`,
        statusLabel: getSampleRevenueGraphNodeStatusLabel(node, context),
        x: point.x,
        y: point.y,
        vx: 0,
        vy: 0,
        radius: getSampleRevenueGraphNodeRadius(node),
        collisionRadius,
        fill: getSampleRevenueGraphNodeColor(node, context),
        labelColor: context ? '#475569' : '#ffffff',
        eligible: node.eligible,
        viewer: node.isViewer,
        context,
        depth: node.depth,
        radialOffsetX: radialTarget.offsetX,
        radialOffsetY: radialTarget.offsetY,
        radialRadius: radialTarget.radius,
      };
    })
  ), [expectedTotalKrw, focusedNodeIds, initialPositions, topology]);
  const canvasEdges = useMemo<CanvasEdge[]>(() => (
    topology.edges.flatMap((edge) => {
      const sourceIndex = nodeIndexById.get(edge.sourceId);
      const targetIndex = nodeIndexById.get(edge.targetId);
      const targetNode = nodeById.get(edge.targetId);
      if (
        sourceIndex == null
        || targetIndex == null
        || !targetNode
      ) {
        return [];
      }
      const context = Boolean(
        focusedNodeIds && !focusedNodeIds.has(edge.targetId),
      );
      const excluded = !targetNode.eligible && !targetNode.isViewer;
      return [{
        sourceIndex,
        targetIndex,
        distance: edge.distance,
        strength: edge.strength,
        stroke: excluded || context ? '#cbd5e1' : '#d6d3d1',
        dashed: excluded,
        context,
        revenueEligible: targetNode.eligible,
      }];
    })
  ), [focusedNodeIds, nodeById, nodeIndexById, topology]);
  const canvasRings = useMemo<CanvasRing[]>(() => {
    const maxEligibleDepth = nodes.reduce(
      (maximum, node) => (
        node.eligible ? Math.max(maximum, node.depth) : maximum
      ),
      0,
    );
    return SAMPLE_REVENUE_GRAPH_GUIDE_DEPTHS
      .filter((depth) => depth <= maxEligibleDepth)
      .map((depth) => ({
        depth,
        radius: getSampleRevenueGraphRadialTargetRadius(depth),
      }));
  }, [nodes]);
  const bridgeSourceKey = useMemo(
    () => escapeInlineJson({
      canvasEdges,
      canvasNodes,
      canvasRings,
      fitInsets,
      overlayBottomInset,
    }),
    [canvasEdges, canvasNodes, canvasRings, fitInsets, overlayBottomInset],
  );
  const bridgeRevision = useMemo(
    () => `${createBridgeRevision()}-${bridgeSourceKey.length}`,
    [bridgeSourceKey],
  );
  const html = useMemo(
    () => buildCanvasHtml({
      bridgeRevision,
      canvasEdges,
      canvasNodes,
      canvasRings,
      fitInsets,
      overlayBottomInset,
    }),
    [
      bridgeRevision,
      canvasEdges,
      canvasNodes,
      canvasRings,
      fitInsets,
      overlayBottomInset,
    ],
  );

  useEffect(() => {
    webViewRef.current?.injectJavaScript(
      `window.__revenueGraph?.fit(); true;`,
    );
  }, [fitRequestId]);

  useEffect(() => {
    if (resetRequestId <= 0) return;
    webViewRef.current?.injectJavaScript(
      `window.__revenueGraph?.reset(); true;`,
    );
  }, [resetRequestId]);

  useEffect(() => {
    webViewRef.current?.injectJavaScript(
      `window.__revenueGraph?.select(${escapeInlineJson(selectedNodeId)}); true;`,
    );
  }, [selectedNodeId]);

  const handleMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        nodeId?: string;
        bridgeRevision?: string;
        documentUrl?: string;
      };
      const nativeUrl = event.nativeEvent.url as string | null | undefined;
      const localNativeUrl = nativeUrl == null
        || nativeUrl === 'null'
        || nativeUrl === 'about:blank';
      if (
        !isFocused
        || !localNativeUrl
        || message.documentUrl !== 'about:blank'
        || message.type !== 'select-node'
        || message.bridgeRevision !== bridgeRevision
        || !message.nodeId
      ) {
        return;
      }
      const node = nodeById.get(message.nodeId);
      const selectable = Boolean(
        node
        && !node.isViewer
        && (!focusedNodeIds || focusedNodeIds.has(node.id)),
      );
      if (node && selectable) {
        onSelectNode(node);
      }
    } catch {
      // Ignore malformed messages from the isolated local document.
    }
  }, [
    bridgeRevision,
    focusedNodeIds,
    isFocused,
    nodeById,
    onSelectNode,
  ]);
  useEffect(() => {
    webViewRef.current?.injectJavaScript(
      `window.__revenueGraph?.setActive(${isFocused}); true;`,
    );
  }, [isFocused]);
  const handleLoadEnd = useCallback(() => {
    webViewRef.current?.injectJavaScript(
      `window.__revenueGraph?.select(${escapeInlineJson(selectedNodeId)});`
      + `window.__revenueGraph?.setActive(${isFocused}); true;`,
    );
  }, [isFocused, selectedNodeId]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html, baseUrl: 'about:blank' }}
        style={styles.webView}
        containerStyle={styles.webViewContainer}
        originWhitelist={['about:blank']}
        javaScriptEnabled
        domStorageEnabled={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        setBuiltInZoomControls={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(request) => (
          request.url === 'about:blank'
        )}
        onMessage={handleMessage}
        onLoadEnd={handleLoadEnd}
        androidLayerType="hardware"
        textZoom={100}
        accessibilityLabel="샘플 매출 기여 노드 엣지 그래프"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fffaf5',
    overflow: 'hidden',
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#fffaf5',
  },
  webView: {
    flex: 1,
    backgroundColor: '#fffaf5',
  },
});
