import { useIsFocused } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, AppState, Platform, ScrollView, View } from 'react-native';

const AUTO_ADVANCE_MS = 5000;

/** Keeps the two decorative loop copies out of the accessible, interactive slide set. */
export function useServicePromotionPager(count: number, fontScale: number) {
  const focused = useIsFocused();
  const pager = useRef<ScrollView>(null);
  const [pageWidth, setPageWidth] = useState(0);
  const [page, setPage] = useState(0);
  const [physicalPage, setPhysicalPage] = useState(1);
  const activePage = useRef(0);
  const physicalOffset = useRef(0);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [pageVisible, setPageVisible] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [touching, setTouching] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const transitionInProgress = useRef(false);
  const transitionTarget = useRef<number | null>(null);
  const dragInProgress = useRef(false);
  const dragBounds = useRef<{ min: number; max: number } | null>(null);
  const queuedDirections = useRef<(-1 | 1)[]>([]);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paused, setPaused] = useState(false);
  const [restart, setRestart] = useState(0);
  const suppressPressUntil = useRef(0);
  const motionAllowed = reduceMotion === false;
  const running = !paused && motionAllowed && focused && appActive && pageVisible && !dragging && !touching && !transitioning && pageWidth > 0;

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    if (queueTimer.current) clearTimeout(queueTimer.current);
  }, []);

  useEffect(() => {
    let alive = true;
    // Until the preference resolves, do not start automatic or animated movement.
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduceMotion(value);
    }).catch(() => { if (alive) setReduceMotion(true); });
    const preference = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const state = AppState.addEventListener('change', (next) => setAppActive(next === 'active'));
    return () => { alive = false; preference.remove(); state.remove(); };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    // A visible banner keeps playing when focus moves to another window.
    // Visibility handles background tabs; pointer blur still cancels gestures below.
    const syncVisibility = () => setPageVisible(document.visibilityState !== 'hidden');
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (!pageWidth) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    if (queueTimer.current) clearTimeout(queueTimer.current);
    queuedDirections.current = [];
    dragBounds.current = null;
    transitionInProgress.current = false;
    transitionTarget.current = null;
    setTransitioning(false);
    const physical = activePage.current + 1;
    setPhysicalPage(physical);
    physicalOffset.current = physical * pageWidth;
    pager.current?.scrollTo({ x: physical * pageWidth, animated: false });
  }, [pageWidth, fontScale]);

  function updatePage(offset: number) {
    if (dragBounds.current) {
      const bounded = Math.max(dragBounds.current.min, Math.min(dragBounds.current.max, offset));
      if (bounded !== offset) pager.current?.scrollTo({ x: bounded, animated: false });
      offset = bounded;
    }
    physicalOffset.current = offset;
    if (!pageWidth) return offset;
    const physical = Math.min(count + 1, Math.max(0, Math.round(offset / pageWidth)));
    const index = (physical - 1 + count) % count;
    activePage.current = index;
    setPage(index);
    setPhysicalPage(physical);
    return offset;
  }

  function trackPage(offset: number) {
    updatePage(offset);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    // RN-web sends a final onScroll, not onMomentumScrollEnd. A bounded quiet
    // period also handles native transitions interrupted without a momentum event.
    if (!dragInProgress.current) settleTimer.current = setTimeout(() => {
      latest.current.settlePage(physicalOffset.current);
    }, 180);
  }

  function settlePage(offset: number) {
    if (dragInProgress.current) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = null;
    offset = updatePage(offset);
    if (!pageWidth) return;
    if (transitionInProgress.current && transitionTarget.current !== null && Math.abs(offset - transitionTarget.current) > 1) {
      // A quiet scroll event can still be an intermediate frame. Preserve the
      // committed destination instead of snapping back toward the drag origin.
      pager.current?.scrollTo({ x: transitionTarget.current, animated: motionAllowed });
      return;
    }
    const physical = Math.min(count + 1, Math.max(0, Math.round(offset / pageWidth)));
    if (Math.abs(offset - physical * pageWidth) > 1) {
      // Web mouse drags use our own snapping instead of competing CSS snap rules.
      transitionInProgress.current = motionAllowed;
      transitionTarget.current = physical * pageWidth;
      setTransitioning(motionAllowed);
      pager.current?.scrollTo({ x: physical * pageWidth, animated: motionAllowed });
      if (!motionAllowed) settlePage(physical * pageWidth);
      return;
    }
    if (physical <= 0 || physical >= count + 1) {
      // Same pixels, different copy: the reset is invisible and never sweeps backwards.
      const real = physical <= 0 ? count : 1;
      physicalOffset.current = real * pageWidth;
      setPhysicalPage(real);
      pager.current?.scrollTo({ x: real * pageWidth, animated: false });
    }
    if (dragBounds.current) {
      // Late native momentum events must not turn the same gesture into another page.
      dragBounds.current = { min: physicalOffset.current, max: physicalOffset.current };
    }
    transitionInProgress.current = false;
    transitionTarget.current = null;
    setTransitioning(false);
    setRestart((value) => value + 1);
    const queued = queuedDirections.current.shift();
    if (queued !== undefined) {
      // Let the invisible clone normalization reach the host before a new motion.
      queueTimer.current = setTimeout(() => latest.current.move(queued), 0);
    }
  }

  function move(direction: -1 | 1, manual = true, from = activePage.current) {
    if (!pageWidth || (!manual && dragInProgress.current)) return;
    if (transitionInProgress.current) {
      if (manual && queuedDirections.current.length < 12) queuedDirections.current.push(direction);
      return;
    }
    if (settleTimer.current) clearTimeout(settleTimer.current);
    dragBounds.current = null;
    transitionInProgress.current = motionAllowed;
    setTransitioning(motionAllowed);
    const next = from + direction;
    const physical = next < 0 ? 0 : next >= count ? count + 1 : next + 1;
    transitionTarget.current = physical * pageWidth;
    const index = (next + count) % count;
    activePage.current = index;
    setPage(index);
    setPhysicalPage(physical);
    pager.current?.scrollTo({ x: physical * pageWidth, animated: motionAllowed });
    if (!motionAllowed) settlePage(physical * pageWidth);
    if (manual) setRestart((value) => value + 1);
  }

  const latest = useRef({ move, pageWidth, motionAllowed, settlePage });
  latest.current = { move, pageWidth, motionAllowed, settlePage };
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => latest.current.move(1, false), AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [running, page, restart]);

  function beginDrag() {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    if (queueTimer.current) clearTimeout(queueTimer.current);
    queuedDirections.current = [];
    transitionInProgress.current = false;
    transitionTarget.current = null;
    setTransitioning(false);
    dragInProgress.current = true;
    const physical = Math.round(physicalOffset.current / pageWidth);
    dragBounds.current = pageWidth ? {
      min: Math.max(0, physical - 1) * pageWidth,
      max: Math.min(count + 1, physical + 1) * pageWidth,
    } : null;
    pager.current?.scrollTo({ x: physicalOffset.current, animated: false });
    suppressPressUntil.current = Number.POSITIVE_INFINITY;
    setDragging(true);
  }
  function endDrag(offset?: number) {
    dragInProgress.current = false;
    transitionInProgress.current = true;
    setTransitioning(true);
    if (offset !== undefined) updatePage(offset);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => latest.current.settlePage(physicalOffset.current), 180);
    suppressPressUntil.current = Date.now() + 400;
    setDragging(false);
    setRestart((value) => value + 1);
  }
  const pointerCleanup = useRef<(() => void) | null>(null);
  const pointerActions = useRef({ beginDrag, endDrag, move, pressIn: () => setTouching(true), pressOut: () => setTouching(false) });
  pointerActions.current = { beginDrag, endDrag, move, pressIn: () => setTouching(true), pressOut: () => { setTouching(false); setRestart((value) => value + 1); } };
  const webSurface = useCallback((instance: View | null) => {
    pointerCleanup.current?.();
    pointerCleanup.current = null;
    if (Platform.OS !== 'web' || !instance || typeof window === 'undefined') return;
    const node = instance as unknown as HTMLElement;
    if (typeof node.addEventListener !== 'function') return;
    let pointer: { id: number; x: number; y: number; offset: number; page: number; dragging: boolean } | null = null;
    function releaseCapture(id: number) {
      try { if (node.hasPointerCapture(id)) node.releasePointerCapture(id); } catch { /* The browser may already have released it. */ }
    }
    function cancel(cleanup = false) {
      const current = pointer;
      pointer = null;
      if (!current) return;
      releaseCapture(current.id);
      if (cleanup) {
        dragInProgress.current = false;
        suppressPressUntil.current = 0;
        return;
      }
      if (current.dragging) {
        const currentWidth = latest.current.pageWidth;
        if (currentWidth > 0) {
          const nearest = Math.min(count + 1, Math.max(0, Math.round(physicalOffset.current / currentWidth)));
          pager.current?.scrollTo({ x: nearest * currentWidth, animated: latest.current.motionAllowed });
        }
        pointerActions.current.endDrag();
      }
      pointerActions.current.pressOut();
    }
    function down(event: PointerEvent) {
      if (event.pointerType !== 'mouse' || event.button !== 0 || pointer) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, offset: physicalOffset.current, page: activePage.current, dragging: false };
      pointerActions.current.pressIn();
    }
    function movePointer(event: PointerEvent) {
      if (!pointer || event.pointerId !== pointer.id) return;
      if (event.buttons === 0) { cancel(); return; }
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      if (!pointer.dragging) {
        if (!latest.current.pageWidth) return;
        if (Math.abs(dx) <= 10 || Math.abs(dx) <= Math.abs(dy) * 1.3) return;
        pointerActions.current.beginDrag();
        pointer.offset = physicalOffset.current;
        pointer.page = activePage.current;
        pointer.dragging = true;
        try { node.setPointerCapture(pointer.id); } catch { /* Window listeners still complete the gesture. */ }
      }
      event.preventDefault();
      const currentWidth = latest.current.pageWidth;
      const offset = Math.max(dragBounds.current?.min ?? 0, Math.min(dragBounds.current?.max ?? (count + 1) * currentWidth, pointer.offset - dx));
      physicalOffset.current = offset;
      pager.current?.scrollTo({ x: offset, animated: false });
    }
    function up(event: PointerEvent) {
      if (!pointer || event.pointerId !== pointer.id) return;
      const current = pointer;
      pointer = null;
      releaseCapture(current.id);
      if (current.dragging) {
        event.preventDefault();
        const dx = event.clientX - current.x;
        const currentWidth = latest.current.pageWidth;
        if (Math.abs(dx) >= Math.min(60, currentWidth * 0.16)) {
          pointerActions.current.move(dx < 0 ? 1 : -1, true, current.page);
        }
        else pager.current?.scrollTo({ x: (current.page + 1) * currentWidth, animated: latest.current.motionAllowed });
        pointerActions.current.endDrag();
      }
      pointerActions.current.pressOut();
    }
    function cancelPointer(event: PointerEvent) { if (pointer?.id === event.pointerId) cancel(); }
    function suppressDragClick(event: MouseEvent) {
      if (Date.now() < suppressPressUntil.current) { event.preventDefault(); event.stopPropagation(); }
    }
    const blur = () => cancel();
    const preventNativeDrag = (event: DragEvent) => event.preventDefault();
    const lostCapture = (event: PointerEvent) => { if (pointer?.id === event.pointerId) cancel(); };
    node.addEventListener('pointerdown', down);
    node.addEventListener('dragstart', preventNativeDrag);
    node.addEventListener('lostpointercapture', lostCapture);
    node.addEventListener('click', suppressDragClick, true);
    window.addEventListener('pointermove', movePointer, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelPointer);
    window.addEventListener('blur', blur);
    pointerCleanup.current = () => {
      cancel(true);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      if (queueTimer.current) clearTimeout(queueTimer.current);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('dragstart', preventNativeDrag);
      node.removeEventListener('lostpointercapture', lostCapture);
      node.removeEventListener('click', suppressDragClick, true);
      window.removeEventListener('pointermove', movePointer);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelPointer);
      window.removeEventListener('blur', blur);
    };
  }, [count]);
  useEffect(() => () => { pointerCleanup.current?.(); pointerCleanup.current = null; }, []);

  return {
    pager, pageWidth, setPageWidth, page, physicalPage, trackPage, settlePage, move,
    paused, reduceMotion,
    webSurface,
    beginDrag, endDrag,
    togglePaused: () => { setPaused((value) => !value); setRestart((value) => value + 1); },
    pressIn: () => { setTouching(true); setRestart((value) => value + 1); },
    pressOut: () => { setTouching(false); setRestart((value) => value + 1); },
    canOpen: () => !transitionInProgress.current && Date.now() >= suppressPressUntil.current,
  };
}
