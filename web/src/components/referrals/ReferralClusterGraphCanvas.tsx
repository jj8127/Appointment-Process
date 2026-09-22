'use client';

import { Button, Center, Group, Loader, Stack, Text } from '@mantine/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReferralGraphCanvasProps } from './ReferralGraphCanvas';
import { getReferralGraphNodeRadius } from '@/lib/referral-graph-highlight';
import type { buildReferralClusterLayout } from '@/lib/referral-graph-cluster-layout';
import type { GraphNode, GraphEdge } from '@/types/referral-graph';

type Layout = ReturnType<typeof buildReferralClusterLayout>;
type Point = { x: number; y: number };
type Position = Layout['positions'][number];
export type ReferralClusterGraphCanvasProps = Omit<ReferralGraphCanvasProps, 'physicsSettings' | 'depthHops'> & {
  layoutNodes: GraphNode[];
  layoutEdges: GraphEdge[];
};

const endpoint = (value: string | { id: string }) => typeof value === 'string' ? value : value.id;
const color = (node: GraphNode) => node.highlightType ? '#facc15' : node.allCommissionsCompleted ? '#0f9f6e' : node.signupCompleted ? '#ea580c' : '#94a3b8';

export function ReferralClusterGraphCanvas(props: ReferralClusterGraphCanvasProps) {
  const { layoutNodes, layoutEdges, descendantCountByNodeId, nodes, edges, width, height, fitRequestId, resetLayoutRequestId, onNodeClick } = props;
  const [layout, setLayout] = useState<Layout | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const camera = useRef({ x: 0, y: 0, scale: 1 });
  const frame = useRef(0);
  const drawRef = useRef<() => void>(() => {});
  const requestDraw = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; drawRef.current(); });
  }, []);
  const input = useMemo(() => ({
    nodes: layoutNodes.map((node) => ({ id: node.id, radius: getReferralGraphNodeRadius({ ...node, descendantCount: descendantCountByNodeId.get(node.id) }) * 1.25 })),
    edges: layoutEdges.map((edge) => ({ source: endpoint(edge.source), target: endpoint(edge.target) })),
  }), [layoutNodes, layoutEdges, descendantCountByNodeId]);

  useEffect(() => {
    let active = true;
    let worker: Worker | undefined;
    const fail = () => { if (active) { setStatus('error'); setLayout(null); } worker?.terminate(); };
    setStatus('loading');
    setLayout(null);
    const timeout = window.setTimeout(fail, 60_000);
    try {
      worker = new Worker(new URL('../../workers/referral-cluster-layout.worker.ts', import.meta.url));
      worker.onmessage = (event: MessageEvent<{ ok: boolean; layout: Layout }>) => {
        if (!active) return;
        window.clearTimeout(timeout);
        if (!event.data.ok) { fail(); return; }
        setLayout(event.data.layout);
        setStatus('ready');
        worker?.terminate();
      };
      worker.onerror = fail;
      worker.onmessageerror = fail;
      worker.postMessage(input);
    } catch { fail(); }
    return () => { active = false; clearTimeout(timeout); worker?.terminate(); };
  }, [input, retry]);

  const scene = useMemo(() => {
    if (!layout) return null;
    const byId = new Map(layout.positions.map((position) => [position.id, position]));
    const visible = new Map(nodes.map((node) => [node.id, node]));
    const parents = new Set(input.edges.map((edge) => edge.source));
    const leaf = new Path2D();
    const backbone = new Path2D();
    const grid = new Map<string, Position[]>();
    const positions = layout.positions.filter((position) => visible.has(position.id));
    let maxRadius = 0;
    for (const position of positions) {
      const key = `${Math.floor(position.x / 64)},${Math.floor(position.y / 64)}`;
      const bucket = grid.get(key) ?? [];
      bucket.push(position); grid.set(key, bucket);
      maxRadius = Math.max(maxRadius, position.radius);
    }
    for (const edge of edges) {
      const source = byId.get(endpoint(edge.source));
      const target = byId.get(endpoint(edge.target));
      if (!source || !target || !visible.has(source.id) || !visible.has(target.id)) continue;
      const path = parents.has(target.id) ? backbone : leaf;
      path.moveTo(source.x, source.y); path.lineTo(target.x, target.y);
    }
    return { byId, visible, positions, grid, maxRadius, leaf, backbone };
  }, [layout, nodes, edges, input]);

  const visiblePositions = useRef<Position[]>([]);
  useEffect(() => { visiblePositions.current = scene?.positions ?? []; }, [scene]);
  const lastFitRequest = useRef(fitRequestId);
  const fit = useCallback((visibleOnly = false) => {
    if (!layout) return;
    let bounds = layout.bounds;
    if (visibleOnly && visiblePositions.current.length > 0) {
      bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const position of visiblePositions.current) {
        bounds.minX = Math.min(bounds.minX, position.x - position.radius);
        bounds.minY = Math.min(bounds.minY, position.y - position.radius);
        bounds.maxX = Math.max(bounds.maxX, position.x + position.radius);
        bounds.maxY = Math.max(bounds.maxY, position.y + position.radius);
      }
    }
    const topPadding = 50;
    const bottomPadding = 120;
    const usableHeight = Math.max(1, height - topPadding - bottomPadding);
    const scale = Math.max(0.0001, Math.min(2, Math.max(1, width - 80) / Math.max(1, bounds.maxX - bounds.minX), usableHeight / Math.max(1, bounds.maxY - bounds.minY)));
    camera.current = { x: width / 2 - (bounds.minX + bounds.maxX) / 2 * scale, y: topPadding + usableHeight / 2 - (bounds.minY + bounds.maxY) / 2 * scale, scale };
    requestDraw();
  }, [layout, width, height, requestDraw]);
  const previousViewport = useRef<{ layout: Layout | null; width: number; height: number; reset: number }>({ layout: null, width, height, reset: resetLayoutRequestId });
  useEffect(() => {
    const previous = previousViewport.current;
    if (layout !== previous.layout || resetLayoutRequestId !== previous.reset) {
      fit();
    } else if (width !== previous.width || height !== previous.height) {
      // Header wrapping and filters can resize the viewport: preserve zoom and
      // the world point at its center rather than resetting the user's camera.
      camera.current.x += (width - previous.width) / 2;
      camera.current.y += (height - previous.height) / 2;
      requestDraw();
    }
    previousViewport.current = { layout, width, height, reset: resetLayoutRequestId };
  }, [fit, layout, width, height, resetLayoutRequestId, requestDraw]);
  useEffect(() => {
    if (lastFitRequest.current === fitRequestId) return;
    lastFitRequest.current = fitRequestId;
    fit(true);
  }, [fit, fitRequestId]);

  const zoom = useCallback((factor: number, point: Point = { x: width / 2, y: height / 2 }) => {
    const current = camera.current;
    const scale = Math.max(0.0001, Math.min(12, current.scale * factor));
    camera.current = { x: point.x - (point.x - current.x) * scale / current.scale, y: point.y - (point.y - current.y) * scale / current.scale, scale };
    requestDraw();
  }, [width, height, requestDraw]);

  useEffect(() => {
    drawRef.current = () => {
      const element = canvas.current;
      const ctx = element?.getContext('2d');
      if (!ctx || !element || !scene) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      if (element.width !== Math.round(width * dpr) || element.height !== Math.round(height * dpr)) {
        element.width = Math.round(width * dpr); element.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fbfdff'; ctx.fillRect(0, 0, width, height);
      const { x, y, scale } = camera.current;
      ctx.translate(x, y); ctx.scale(scale, scale);
      ctx.lineWidth = Math.max(1.6, 1.1 / scale); ctx.strokeStyle = '#758fa4'; ctx.stroke(scene.leaf);
      ctx.lineWidth = Math.max(2, 1.25 / scale); ctx.strokeStyle = '#5e7c94'; ctx.stroke(scene.backbone);
      const search = props.searchTerm.trim().toLocaleLowerCase();
      const labels: Array<{ position: Position; node: GraphNode; priority: boolean }> = [];
      for (const position of scene.positions) {
        const screenX = position.x * scale + x; const screenY = position.y * scale + y;
        if (screenX < -100 || screenX > width + 100 || screenY < -60 || screenY > height + 60) continue;
        const node = scene.visible.get(position.id)!;
        const selected = node.id === props.selectedNodeId;
        const match = !!search && `${node.name} ${node.affiliation} ${node.activeCode ?? ''}`.toLocaleLowerCase().includes(search);
        ctx.beginPath(); ctx.arc(position.x, position.y, position.radius, 0, Math.PI * 2);
        ctx.fillStyle = color(node); ctx.fill();
        if (selected || match || node.highlightType || node.hasLegacyUnresolved) {
          ctx.lineWidth = Math.max(1.2, (selected ? 2.5 : 1.4) / scale);
          ctx.strokeStyle = selected ? '#0f172a' : match ? '#ea580c' : node.hasLegacyUnresolved ? '#ca8a04' : '#a16207'; ctx.stroke();
        }
        labels.push({ position, node, priority: selected || match });
      }
      // Keep every visible name, scaling normal labels with the camera.
      // Selected/search labels paint last at readable CSS size, including their code.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      labels.sort((a, b) => Number(a.priority) - Number(b.priority));
      for (const { position, node, priority } of labels) {
        const label = priority && node.activeCode ? `${node.name} · ${node.activeCode}` : node.name;
        const fontSize = priority ? 12 : Math.max(3, Math.min(12, 12 * scale));
        ctx.font = `${priority ? 700 : 500} ${fontSize}px sans-serif`;
        const labelWidth = ctx.measureText(label).width;
        const left = position.x * scale + x - labelWidth / 2;
        const top = position.y * scale + y + position.radius * scale + 5;
        ctx.lineWidth = Math.max(1, fontSize / 4); ctx.strokeStyle = '#fbfdff'; ctx.strokeText(label, left, top + fontSize);
        ctx.fillStyle = '#334155'; ctx.fillText(label, left, top + fontSize);
      }
    };
    requestDraw();
  }, [scene, width, height, props.selectedNodeId, props.searchTerm, requestDraw]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !scene) return;
    const pointers = new Map<number, Point>();
    let moved = false;
    let origin: Point | null = null;
    const local = (event: PointerEvent | WheelEvent) => { const rect = element.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const point = local(event);
      if (!pointers.size) { moved = false; origin = point; }
      else moved = true;
      pointers.set(event.pointerId, point); element.setPointerCapture(event.pointerId);
      element.focus({ preventScroll: true });
    };
    const move = (event: PointerEvent) => {
      const before = pointers.get(event.pointerId); if (!before) return;
      const point = local(event);
      if (origin && Math.hypot(point.x - origin.x, point.y - origin.y) > 5) moved = true;
      if (pointers.size === 1) { camera.current.x += point.x - before.x; camera.current.y += point.y - before.y; }
      else {
        const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)![1];
        const oldMid = { x: (before.x + other.x) / 2, y: (before.y + other.y) / 2 };
        const nextMid = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
        const oldDistance = Math.hypot(before.x - other.x, before.y - other.y);
        const distance = Math.hypot(point.x - other.x, point.y - other.y);
        if (oldDistance > 1 && distance > 1) zoom(distance / oldDistance, oldMid);
        camera.current.x += nextMid.x - oldMid.x; camera.current.y += nextMid.y - oldMid.y;
      }
      pointers.set(event.pointerId, point); requestDraw();
    };
    const up = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (event.type === 'pointerup' && !moved && !pointers.size) {
        const point = local(event); const current = camera.current;
        const world = { x: (point.x - current.x) / current.scale, y: (point.y - current.y) / current.scale };
        const reach = Math.max(scene.maxRadius, 14 / current.scale);
        let best: Position | undefined; let closest = Infinity;
        // Avoid enumerating huge numbers of empty cells at extreme fit scales.
        const candidates: Position[] = [];
        if (reach > 512) candidates.push(...scene.positions);
        else for (let gx = Math.floor((world.x - reach) / 64); gx <= Math.floor((world.x + reach) / 64); gx++) for (let gy = Math.floor((world.y - reach) / 64); gy <= Math.floor((world.y + reach) / 64); gy++) candidates.push(...(scene.grid.get(`${gx},${gy}`) ?? []));
        for (const position of candidates) {
          const distance = Math.hypot(position.x - world.x, position.y - world.y);
          if (distance <= Math.max(position.radius, 14 / current.scale) && distance < closest) { best = position; closest = distance; }
        }
        if (best) onNodeClick(scene.visible.get(best.id)!);
      }
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    };
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(Math.exp(-Math.max(-200, Math.min(200, event.deltaY * (event.deltaMode === 1 ? 16 : 1))) * 0.002), local(event)); };
    element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up); element.addEventListener('pointercancel', up); element.addEventListener('lostpointercapture', up);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up); element.removeEventListener('pointercancel', up); element.removeEventListener('lostpointercapture', up); element.removeEventListener('wheel', wheel);
    };
  }, [scene, zoom, requestDraw, onNodeClick, status]);
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
  }, []);

  if (status !== 'ready') return <Center h="100%"><Stack align="center" gap="xs">{status === 'loading' ? <Loader color="orange" /> : null}<Text size="sm" role="status">{status === 'loading' ? '집단 배치를 준비하고 있습니다…' : '집단 배치를 불러오지 못했습니다.'}</Text>{status === 'error' ? <Button variant="light" onClick={() => setRetry((value) => value + 1)}>다시 시도</Button> : null}</Stack></Center>;
  return <>
    <canvas ref={canvas} aria-label="추천인 집단 그래프. 방향키로 이동, 더하기와 빼기로 확대 축소, Home으로 전체 보기. 사람 선택은 검색 결과 또는 아래 목록을 이용하세요." tabIndex={0} style={{ position: 'absolute', inset: 0, width, height, display: 'block', touchAction: 'none', cursor: 'grab' }} onKeyDown={(event) => {
      if (event.key === '+' || event.key === '=') zoom(1.3);
      else if (event.key === '-') zoom(1 / 1.3);
      else if (event.key === 'Home') fit();
      else if (event.key.startsWith('Arrow')) { camera.current.x += event.key === 'ArrowLeft' ? 50 : event.key === 'ArrowRight' ? -50 : 0; camera.current.y += event.key === 'ArrowUp' ? 50 : event.key === 'ArrowDown' ? -50 : 0; requestDraw(); }
      else return;
      event.preventDefault();
    }} />
    <Group gap={4} style={{ position: 'absolute', right: 16, bottom: width < 640 ? 112 : 16, zIndex: 3 }}><Button aria-label="그래프 축소" variant="default" onClick={() => zoom(1 / 1.3)}>−</Button><Button aria-label="그래프 확대" variant="default" onClick={() => zoom(1.3)}>＋</Button></Group>
    {nodes.length === 0 ? <Center style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}><Text>지금 조건에 맞는 사람이 없습니다.</Text></Center> : null}
    <details onToggle={(event) => setListOpen(event.currentTarget.open)} style={{ position: 'absolute', left: 16, top: 16, zIndex: 3, maxHeight: '45%', maxWidth: '70%', overflow: 'auto', background: '#fff', borderRadius: 6 }}><summary style={{ padding: 8, cursor: 'pointer', fontSize: 12 }}>사람 목록으로 선택 ({nodes.length}명)</summary><Stack gap={2} p="xs">{listOpen ? nodes.map((node) => <Button key={node.id} variant={node.id === props.selectedNodeId ? 'light' : 'subtle'} size="compact-xs" onClick={() => onNodeClick(node)}>{node.name}</Button>) : null}</Stack></details>
  </>;
}
