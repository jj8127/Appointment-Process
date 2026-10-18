'use client';

import { Button, Center, Group, Loader, Stack, Text } from '@mantine/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReferralGraphCanvasProps } from './ReferralGraphCanvas';
import { getReferralGraphNodeRadius } from '@/lib/referral-graph-highlight';
import {
  buildReferralNeighborIndex, easeTowards, OBSIDIAN_HOVER_GROW, referralHoverNodeAlpha, referralLabelAlpha,
} from '@/lib/referral-graph-obsidian-view';
import type { buildReferralClusterLayout } from '@/lib/referral-graph-cluster-layout';
import type { GraphNode, GraphEdge } from '@/types/referral-graph';

type Layout = ReturnType<typeof buildReferralClusterLayout>;
type Point = { x: number; y: number };
type Position = Layout['positions'][number];
export type ReferralClusterGraphCanvasProps = Omit<ReferralGraphCanvasProps, 'physicsSettings' | 'depthHops'> & {
  layoutNodes: GraphNode[];
  layoutEdges: GraphEdge[];
  /** 오른쪽 상세 패널이 가리는 폭(px). 맞춤 시 이 영역을 피해 가운데 둔다. */
  insetRight?: number;
};

const endpoint = (value: string | { id: string }) => typeof value === 'string' ? value : value.id;
const HOVER_ACCENT = '#ea580c';
/** Obsidian 실측: 목표 배율까지 프레임당 약 9%씩 감속(0.5→1 전환 약 0.8초) */
const ZOOM_EASE_PER_FRAME = 0.09;
/** 관성 감쇠: 프레임당 속도 유지율. 0.9면 놓은 속도의 약 170ms어치를 더 미끄러진다. */
const PAN_FRICTION_PER_FRAME = 0.9;
/** 과도한 날아감 방지: 최대 관성 속도(px/ms)와 속도 계산의 최소 이벤트 간격(ms) */
const PAN_MAX_SPEED = 2;
const PAN_MIN_EVENT_MS = 8;
/** 손을 멈춘 채 이만큼 지나 놓으면 관성 없이 멈춘다 */
const PAN_RELEASE_IDLE_MS = 80;
const color = (node: GraphNode) => node.highlightType ? '#facc15' : node.allCommissionsCompleted ? '#0f9f6e' : node.signupCompleted ? '#ea580c' : '#94a3b8';

export function ReferralClusterGraphCanvas(props: ReferralClusterGraphCanvasProps) {
  const { layoutNodes, layoutEdges, descendantCountByNodeId, nodes, edges, width, height, fitRequestId, resetLayoutRequestId, onNodeClick, insetRight = 0 } = props;
  const [layout, setLayout] = useState<Layout | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const camera = useRef({ x: 0, y: 0, scale: 1 });
  // 휠·버튼 줌은 목표 배율로 부드럽게 다가간다(핀치는 즉시).
  const zoomTarget = useRef<{ scale: number; point: Point } | null>(null);
  // 호버 강조: shownId는 사라지는 동안에도 유지해 서서히 흐려짐이 풀리게 한다.
  const hover = useRef<{ id: string | null; shownId: string | null; mix: number }>({ id: null, shownId: null, mix: 0 });
  const lastFrameAt = useRef(0);
  // 드래그를 놓은 뒤 마지막 속도로 미끄러지다 멈춘다(Obsidian 팬 관성). 단위: px/ms
  const panVelocity = useRef<{ x: number; y: number } | null>(null);
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
    const neighbors = buildReferralNeighborIndex(edges.filter((edge) => visible.has(endpoint(edge.source)) && visible.has(endpoint(edge.target))));
    return { byId, visible, positions, grid, maxRadius, leaf, backbone, neighbors };
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
    const usableWidth = Math.max(120, width - insetRight);
    const scale = Math.max(0.0001, Math.min(2, Math.max(1, usableWidth - 80) / Math.max(1, bounds.maxX - bounds.minX), usableHeight / Math.max(1, bounds.maxY - bounds.minY)));
    camera.current = { x: usableWidth / 2 - (bounds.minX + bounds.maxX) / 2 * scale, y: topPadding + usableHeight / 2 - (bounds.minY + bounds.maxY) / 2 * scale, scale };
    zoomTarget.current = null;
    panVelocity.current = null;
    requestDraw();
  }, [layout, width, height, insetRight, requestDraw]);
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
  // 사람을 고르면 그 주변(로컬 그래프)만 남으므로 그 범위에 화면을 맞춘다. 선택을 풀면 전체로 돌아간다.
  const lastSelection = useRef(props.selectedNodeId);
  useEffect(() => {
    if (lastSelection.current === props.selectedNodeId || !scene) return;
    lastSelection.current = props.selectedNodeId;
    fit(Boolean(props.selectedNodeId));
  }, [props.selectedNodeId, scene, fit]);
  useEffect(() => {
    if (lastFitRequest.current === fitRequestId) return;
    lastFitRequest.current = fitRequestId;
    fit(true);
  }, [fit, fitRequestId]);

  const zoom = useCallback((factor: number, point: Point = { x: width / 2, y: height / 2 }, immediate = false) => {
    const current = camera.current;
    const from = immediate ? current.scale : zoomTarget.current?.scale ?? current.scale;
    const scale = Math.max(0.0001, Math.min(12, from * factor));
    if (immediate) {
      zoomTarget.current = null;
      camera.current = { x: point.x - (point.x - current.x) * scale / current.scale, y: point.y - (point.y - current.y) * scale / current.scale, scale };
    } else zoomTarget.current = { scale, point };
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
      // 줌 감속과 호버 흐림을 시간 기준으로 한 단계 진행
      const now = performance.now();
      const elapsed = lastFrameAt.current ? Math.min(100, now - lastFrameAt.current) : 16;
      lastFrameAt.current = now;
      let animating = false;
      const target = zoomTarget.current;
      const glide = panVelocity.current;
      if (glide) {
        camera.current.x += glide.x * elapsed; camera.current.y += glide.y * elapsed;
        const decay = Math.pow(PAN_FRICTION_PER_FRAME, elapsed / (1000 / 60));
        glide.x *= decay; glide.y *= decay;
        if (Math.hypot(glide.x, glide.y) < 0.01) panVelocity.current = null; else animating = true;
      }
      if (target) {
        const current = camera.current;
        const next = easeTowards(current.scale, target.scale, elapsed, ZOOM_EASE_PER_FRAME);
        camera.current = { x: target.point.x - (target.point.x - current.x) * next / current.scale, y: target.point.y - (target.point.y - current.y) * next / current.scale, scale: next };
        if (next === target.scale) zoomTarget.current = null; else animating = true;
      }
      const hv = hover.current;
      hv.mix = easeTowards(hv.mix, hv.id ? 1 : 0, elapsed);
      if (hv.mix === 0 && !hv.id) hv.shownId = null;
      if (hv.mix !== (hv.id ? 1 : 0)) animating = true;
      const focusId = hv.shownId && scene.visible.has(hv.shownId) ? hv.shownId : null;
      const focusSet = focusId ? scene.neighbors.get(focusId) : undefined;
      const inFocus = (id: string) => !focusId || id === focusId || !!focusSet?.has(id);
      const mix = focusId ? hv.mix : 0;
      const { x, y, scale } = camera.current;
      ctx.translate(x, y); ctx.scale(scale, scale);
      ctx.globalAlpha = referralHoverNodeAlpha(false, mix);
      ctx.lineWidth = Math.max(1.6, 1.1 / scale); ctx.strokeStyle = '#758fa4'; ctx.stroke(scene.leaf);
      ctx.lineWidth = Math.max(2, 1.25 / scale); ctx.strokeStyle = '#5e7c94'; ctx.stroke(scene.backbone);
      ctx.globalAlpha = 1;
      const focusPosition = focusId ? scene.byId.get(focusId) : undefined;
      if (focusPosition && focusSet && mix > 0) {
        // 대상과 이웃을 잇는 선만 강조색으로 다시 긋는다(Obsidian 호버)
        ctx.beginPath();
        for (const id of focusSet) {
          const other = scene.byId.get(id);
          if (!other || !scene.visible.has(id)) continue;
          ctx.moveTo(focusPosition.x, focusPosition.y); ctx.lineTo(other.x, other.y);
        }
        ctx.globalAlpha = mix; ctx.lineWidth = Math.max(2.4, 2.4 / scale); ctx.strokeStyle = HOVER_ACCENT; ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const search = props.searchTerm.trim().toLocaleLowerCase();
      const labels: Array<{ position: Position; node: GraphNode; priority: boolean; alpha: number }> = [];
      for (const position of scene.positions) {
        const screenX = position.x * scale + x; const screenY = position.y * scale + y;
        if (screenX < -100 || screenX > width + 100 || screenY < -60 || screenY > height + 60) continue;
        const node = scene.visible.get(position.id)!;
        const selected = node.id === props.selectedNodeId;
        const match = !!search && `${node.name} ${node.affiliation} ${node.activeCode ?? ''}`.toLocaleLowerCase().includes(search);
        const focused = node.id === focusId;
        const alpha = referralHoverNodeAlpha(inFocus(node.id), mix);
        ctx.globalAlpha = alpha;
        ctx.beginPath(); ctx.arc(position.x, position.y, position.radius * (focused ? 1 + OBSIDIAN_HOVER_GROW * mix : 1), 0, Math.PI * 2);
        ctx.fillStyle = color(node); ctx.fill();
        if (focused && mix > 0) {
          ctx.lineWidth = Math.max(1.5, 3 / scale); ctx.strokeStyle = HOVER_ACCENT; ctx.stroke();
        } else if (selected || match || node.highlightType || node.hasLegacyUnresolved) {
          ctx.lineWidth = Math.max(1.2, (selected ? 2.5 : 1.4) / scale);
          ctx.strokeStyle = selected ? '#0f172a' : match ? '#ea580c' : node.hasLegacyUnresolved ? '#ca8a04' : '#a16207'; ctx.stroke();
        }
        ctx.globalAlpha = 1;
        labels.push({ position, node, priority: selected || match || (!!focusId && mix > 0.5 && inFocus(node.id)), alpha });
      }
      // Normal labels scale with the camera and fade out once too small to read (Obsidian text fade).
      // Selected/search/hover-neighborhood labels paint last at readable CSS size, including their code.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      labels.sort((a, b) => Number(a.priority) - Number(b.priority));
      for (const { position, node, priority, alpha } of labels) {
        const label = priority && node.activeCode ? `${node.name} · ${node.activeCode}` : node.name;
        const fontSize = priority ? 12 : Math.max(3, Math.min(12, 12 * scale));
        const labelAlpha = priority ? 1 : referralLabelAlpha(fontSize) * alpha;
        if (labelAlpha <= 0.01) continue;
        ctx.globalAlpha = labelAlpha;
        ctx.font = `${priority ? 700 : 500} ${fontSize}px sans-serif`;
        const labelWidth = ctx.measureText(label).width;
        const left = position.x * scale + x - labelWidth / 2;
        const top = position.y * scale + y + position.radius * scale + 5;
        ctx.lineWidth = Math.max(1, fontSize / 4); ctx.strokeStyle = '#fbfdff'; ctx.strokeText(label, left, top + fontSize);
        ctx.fillStyle = '#334155'; ctx.fillText(label, left, top + fontSize);
      }
      ctx.globalAlpha = 1;
      if (animating) requestDraw();
    };
    requestDraw();
  }, [scene, width, height, props.selectedNodeId, props.searchTerm, requestDraw]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !scene) return;
    const pointers = new Map<number, Point>();
    let moved = false;
    let origin: Point | null = null;
    let velocity = { x: 0, y: 0 };
    let lastMoveAt = 0;
    const local = (event: PointerEvent | WheelEvent) => { const rect = element.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const point = local(event);
      panVelocity.current = null;
      velocity = { x: 0, y: 0 }; lastMoveAt = performance.now();
      if (!pointers.size) { moved = false; origin = point; }
      else moved = true;
      pointers.set(event.pointerId, point); element.setPointerCapture(event.pointerId);
      element.focus({ preventScroll: true });
    };
    const move = (event: PointerEvent) => {
      const before = pointers.get(event.pointerId); if (!before) return;
      const point = local(event);
      if (origin && Math.hypot(point.x - origin.x, point.y - origin.y) > 5) moved = true;
      if (pointers.size === 1) {
        const dx = point.x - before.x; const dy = point.y - before.y;
        camera.current.x += dx; camera.current.y += dy;
        const now = performance.now(); const dt = Math.max(PAN_MIN_EVENT_MS, now - lastMoveAt); lastMoveAt = now;
        // 최근 움직임에 가중치를 둔 속도(튀는 이벤트 간격 완화)
        velocity = { x: velocity.x * 0.2 + (dx / dt) * 0.8, y: velocity.y * 0.2 + (dy / dt) * 0.8 };
      }
      else {
        const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)![1];
        const oldMid = { x: (before.x + other.x) / 2, y: (before.y + other.y) / 2 };
        const nextMid = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
        const oldDistance = Math.hypot(before.x - other.x, before.y - other.y);
        const distance = Math.hypot(point.x - other.x, point.y - other.y);
        if (oldDistance > 1 && distance > 1) zoom(distance / oldDistance, oldMid, true);
        camera.current.x += nextMid.x - oldMid.x; camera.current.y += nextMid.y - oldMid.y;
      }
      pointers.set(event.pointerId, point); requestDraw();
    };
    const pick = (point: Point) => {
      const current = camera.current;
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
      return best;
    };
    const setHover = (id: string | null) => {
      const hv = hover.current;
      if (hv.id === id) return;
      hv.id = id;
      if (id) hv.shownId = id;
      element.style.cursor = id ? 'pointer' : 'grab';
      requestDraw();
    };
    const hoverMove = (event: PointerEvent) => {
      if (pointers.size || event.pointerType !== 'mouse') return;
      setHover(pick(local(event))?.id ?? null);
    };
    const leave = () => { if (!pointers.size) setHover(null); };
    const up = (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.delete(event.pointerId);
      if (event.type === 'pointerup' && moved && !pointers.size && performance.now() - lastMoveAt < PAN_RELEASE_IDLE_MS
        && Math.hypot(velocity.x, velocity.y) > 0.05) {
        const speed = Math.hypot(velocity.x, velocity.y);
        const limit = speed > PAN_MAX_SPEED ? PAN_MAX_SPEED / speed : 1;
        panVelocity.current = { x: velocity.x * limit, y: velocity.y * limit };
        requestDraw();
      }
      if (event.type === 'pointerup' && !moved && !pointers.size) {
        const best = pick(local(event));
        if (best) onNodeClick(scene.visible.get(best.id)!);
      }
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    };
    const wheel = (event: WheelEvent) => { event.preventDefault(); zoom(Math.exp(-Math.max(-200, Math.min(200, event.deltaY * (event.deltaMode === 1 ? 16 : 1))) * 0.002), local(event)); };
    element.addEventListener('pointerdown', down); element.addEventListener('pointermove', move);
    element.addEventListener('pointermove', hoverMove); element.addEventListener('pointerleave', leave);
    element.addEventListener('pointerup', up); element.addEventListener('pointercancel', up); element.addEventListener('lostpointercapture', up);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', move);
      element.removeEventListener('pointermove', hoverMove); element.removeEventListener('pointerleave', leave);
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
