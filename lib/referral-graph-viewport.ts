import { REFERRAL_GRAPH_SURFACE_CENTER } from './referral-graph-native';
import type { GraphRect } from './referral-graph-readable';
import type { ReferralGraphPoint } from '@/types/referral-graph';

export type ReferralGraphCameraSnapshot = {
  scale: number;
  panX: number;
  panY: number;
  width: number;
  height: number;
};

/** The settled label layer follows the live camera without hiding or rebasing. */
export function getReferralGraphLabelScale(liveScale: number, layoutScale: number) {
  'worklet';
  return Number.isFinite(liveScale) && liveScale > 0 && Number.isFinite(layoutScale) && layoutScale > 0
    ? liveScale / layoutScale : 1;
}

export function getReferralGraphLabelRect(
  point: ReferralGraphPoint,
  placement: { offsetX: number; offsetY: number; width: number; height: number },
  layoutScale: number,
  camera: ReferralGraphCameraSnapshot,
): GraphRect {
  const ratio = getReferralGraphLabelScale(camera.scale, layoutScale);
  return {
    x: (point.x - REFERRAL_GRAPH_SURFACE_CENTER) * camera.scale + camera.width / 2 + camera.panX + placement.offsetX * ratio,
    y: (point.y - REFERRAL_GRAPH_SURFACE_CENTER) * camera.scale + camera.height / 2 + camera.panY + placement.offsetY * ratio,
    width: placement.width * ratio,
    height: placement.height * ratio,
  };
}

export function isReferralGraphLabelVisible(rect: GraphRect, width: number, height: number, overscan: number) {
  return rect.x + rect.width >= -overscan && rect.x <= width + overscan
    && rect.y + rect.height >= -overscan && rect.y <= height + overscan;
}

/** Inverse of projectReferralGraphPoint; padding is measured in screen dp. */
export function getReferralGraphViewportWorldRect(
  camera: ReferralGraphCameraSnapshot,
  paddingScreen = 0,
): GraphRect {
  'worklet';
  const scale = Number.isFinite(camera.scale) && camera.scale > 0 ? camera.scale : 1;
  const padding = Math.max(0, paddingScreen);
  const width = Math.max(0, camera.width);
  const height = Math.max(0, camera.height);
  return {
    x: REFERRAL_GRAPH_SURFACE_CENTER - (width / 2 + camera.panX + padding) / scale,
    y: REFERRAL_GRAPH_SURFACE_CENTER - (height / 2 + camera.panY + padding) / scale,
    width: (width + padding * 2) / scale,
    height: (height + padding * 2) / scale,
  };
}

/** Inclusive bounds retain hit targets and labels touching the viewport edge. */
export function isReferralGraphPointInRect(
  point: ReferralGraphPoint,
  rect: GraphRect,
  paddingWorld = 0,
) {
  'worklet';
  const padding = Math.max(0, paddingWorld);
  return point.x >= rect.x - padding && point.x <= rect.x + rect.width + padding
    && point.y >= rect.y - padding && point.y <= rect.y + rect.height + padding;
}

/** Slab clipping also retains crossing edges whose endpoints are both outside. */
export function doesReferralGraphSegmentIntersectRect(
  source: ReferralGraphPoint,
  target: ReferralGraphPoint,
  rect: GraphRect,
  paddingWorld = 0,
) {
  'worklet';
  const padding = Math.max(0, paddingWorld);
  const left = rect.x - padding;
  const right = rect.x + rect.width + padding;
  const top = rect.y - padding;
  const bottom = rect.y + rect.height + padding;
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  let enter = 0;
  let leave = 1;

  if (dx === 0) {
    if (source.x < left || source.x > right) return false;
  } else {
    const first = (left - source.x) / dx;
    const second = (right - source.x) / dx;
    enter = Math.max(enter, Math.min(first, second));
    leave = Math.min(leave, Math.max(first, second));
    if (enter > leave) return false;
  }

  if (dy === 0) {
    if (source.y < top || source.y > bottom) return false;
  } else {
    const first = (top - source.y) / dy;
    const second = (bottom - source.y) / dy;
    enter = Math.max(enter, Math.min(first, second));
    leave = Math.min(leave, Math.max(first, second));
    if (enter > leave) return false;
  }
  return true;
}

/**
 * Refresh before the mounted overscan is exhausted, with half reserved for delivery.
 * Cull against getReferralGraphViewportWorldRect(previous, overscan + primitivePadding).
 * primitivePadding must cover the largest screen-space label, ring, or hit target.
 * Compare against the last committed snapshot; queued snapshots are not mounted yet.
 */
export function shouldRefreshReferralGraphViewport(
  previous: ReferralGraphCameraSnapshot,
  next: ReferralGraphCameraSnapshot,
  overscanScreen = 160,
  scaleRatioThreshold = 1.1,
  primitivePaddingScreen = 0,
) {
  'worklet';
  if (previous.width !== next.width || previous.height !== next.height) return true;
  if (!Number.isFinite(previous.scale) || !Number.isFinite(next.scale)
    || previous.scale <= 0 || next.scale <= 0) return true;

  const ratio = next.scale / previous.scale;
  const threshold = Math.max(1, scaleRatioThreshold);
  if (ratio > threshold || ratio < 1 / threshold) return true;

  const padding = Math.max(0, primitivePaddingScreen);
  const safe = getReferralGraphViewportWorldRect(previous, Math.max(0, overscanScreen) / 2 + padding);
  const visible = getReferralGraphViewportWorldRect(next, padding);
  return visible.x < safe.x || visible.y < safe.y
    || visible.x + visible.width > safe.x + safe.width
    || visible.y + visible.height > safe.y + safe.height;
}
