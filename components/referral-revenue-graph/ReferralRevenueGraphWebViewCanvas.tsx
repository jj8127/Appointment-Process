import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import WebView, { type WebViewMessageEvent } from 'react-native-webview';

import {
  buildSampleRevenueGraphLayout,
  formatCompactSampleRevenueKrw,
  formatSampleRevenueNodeAmount,
  getSampleRevenueGraphNodeColor,
  getSampleRevenueGraphNodeRadius,
  getSampleRevenueGraphNodeStatusLabel,
  prepareSampleRevenueGraphPhysicsTopology,
  SAMPLE_REVENUE_ADMIN_WEB_PHYSICS,
  SAMPLE_REVENUE_GRAPH_MAX_SCALE,
  SAMPLE_REVENUE_GRAPH_MIN_SCALE,
  SAMPLE_REVENUE_GRAPH_SURFACE_SIZE,
} from '@/lib/referral-revenue-graph-native';
import type {
  SampleRevenueGraphEdge,
  SampleRevenueGraphNode,
} from '@/types/referral-revenue-graph';

type Props = {
  nodes: SampleRevenueGraphNode[];
  edges: SampleRevenueGraphEdge[];
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
};

type CanvasEdge = {
  sourceIndex: number;
  targetIndex: number;
  distance: number;
  strength: number;
  stroke: string;
  dashed: boolean;
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
  fitInsets,
  overlayBottomInset,
}: {
  bridgeRevision: string;
  canvasEdges: CanvasEdge[];
  canvasNodes: CanvasNode[];
  fitInsets: Props['fitInsets'];
  overlayBottomInset: number;
}) => {
  const payload = escapeInlineJson({
    bridgeRevision,
    nodes: canvasNodes,
    edges: canvasEdges,
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
  <canvas id="graph" role="img" aria-label="샘플 매출 기여 노드 엣지 그래프. 빈 공간은 한 손가락으로 이동하고, 노드는 끌어서 움직이며, 두 손가락으로 확대하거나 축소할 수 있습니다."></canvas>
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
    const center = config.surfaceSize / 2;
    const physics = config.physics;
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
    const dragActivationDistance = 6;

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const graphToScreenX = (x) => width / 2 + view.panX + (x - center) * view.scale;
    const graphToScreenY = (y) => height / 2 + view.panY + (y - center) * view.scale;
    const screenToGraph = (x, y) => ({
      x: center + (x - width / 2 - view.panX) / Math.max(view.scale, 0.001),
      y: center + (y - height / 2 - view.panY) / Math.max(view.scale, 0.001),
    });
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
      180,
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
      const spanX = Math.max(1, maxX - minX);
      const spanY = Math.max(1, maxY - minY);
      view.scale = clamp(
        Math.min(usableWidth / spanX, usableHeight / spanY),
        config.minScale,
        config.maxScale,
      );
      const graphCenterX = (minX + maxX) / 2;
      const graphCenterY = (minY + maxY) / 2;
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

    const stepPhysics = (alpha, fixedIndex, fixedPosition) => {
      for (let index = 0; index < nodes.length; index += 1) {
        if (index === fixedIndex) continue;
        const node = nodes[index];
        node.vx += (center - node.x) * physics.centerStrength * alpha;
        node.vy += (center - node.y) * physics.centerStrength * alpha;
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
          node.x = clamp(fixedPosition.x, 70, config.surfaceSize - 70);
          node.y = clamp(fixedPosition.y, 70, config.surfaceSize - 70);
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        node.vx *= velocityRetention;
        node.vy *= velocityRetention;
        node.x = clamp(node.x + node.vx, 70, config.surfaceSize - 70);
        node.y = clamp(node.y + node.vy, 70, config.surfaceSize - 70);
      }
    };

    const draw = (now) => {
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.fillStyle = '#fffaf5';
      ctx.fillRect(0, 0, width, height);
      ctx.lineCap = 'round';

      for (const edge of edges) {
        const source = nodes[edge.sourceIndex];
        const target = nodes[edge.targetIndex];
        ctx.beginPath();
        ctx.moveTo(graphToScreenX(source.x), graphToScreenY(source.y));
        ctx.lineTo(graphToScreenX(target.x), graphToScreenY(target.y));
        ctx.strokeStyle = edge.stroke;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(edge.dashed ? [5, 5] : []);
        ctx.stroke();
      }
      ctx.setLineDash([]);

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
            x - 90,
            y + radius + 7,
            180,
            38,
          );
        }
      }

      if (activePhysics || settleAlpha > 0.014) {
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
      } else if (settleAlpha > 0.014) {
        settleAlpha *= 0.94;
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
      if (dirty || zoomBadgeVisible) {
        draw(now);
        dirty = false;
      }
      if (activePhysics || settleAlpha > 0 || zoomBadgeVisible) {
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
        scale: view.scale,
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
        config.minScale,
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
            selectedNodeId = node.id;
            window.ReactNativeWebView?.postMessage(JSON.stringify({
              type: 'select-node',
              nodeId: node.id,
              bridgeRevision: config.bridgeRevision,
              documentUrl: window.location.href,
            }));
          }
        }
        activePhysics = false;
        settleAlpha = !cancelled && dragMoved ? 0.32 : 0;
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
        selectedNodeId = node.id;
        dirty = true;
        requestLoop();
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
        selectedNodeId = null;
        fit();
      },
      select: (nodeId) => {
        selectedNodeId = typeof nodeId === 'string' ? nodeId : null;
        dirty = true;
        requestLoop();
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
    topology.nodes.map(({ node, collisionRadius }) => {
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
          ? '기준'
          : node.eligible
            ? formatSampleRevenueNodeAmount(node.expectedAllocationKrw)
            : '제외',
        selectedAmountLabel: node.isViewer
          ? '기준'
          : node.eligible
            ? formatCompactSampleRevenueKrw(node.expectedAllocationKrw)
            : '대상 제외',
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
      };
    })
  ), [focusedNodeIds, initialPositions, topology]);
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
        stroke: excluded || context ? '#cbd5e1' : '#fdba74',
        dashed: excluded,
      }];
    })
  ), [focusedNodeIds, nodeById, nodeIndexById, topology]);
  const bridgeSourceKey = useMemo(
    () => escapeInlineJson({
      canvasEdges,
      canvasNodes,
      fitInsets,
      overlayBottomInset,
    }),
    [canvasEdges, canvasNodes, fitInsets, overlayBottomInset],
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
      fitInsets,
      overlayBottomInset,
    }),
    [
      bridgeRevision,
      canvasEdges,
      canvasNodes,
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
