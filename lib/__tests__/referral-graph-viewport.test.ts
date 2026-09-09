import { projectReferralGraphPoint } from '../referral-graph-readable';
import {
  doesReferralGraphSegmentIntersectRect,
  getReferralGraphLabelRect,
  getReferralGraphLabelScale,
  getReferralGraphViewportWorldRect,
  isReferralGraphPointInRect,
  isReferralGraphLabelVisible,
  shouldRefreshReferralGraphViewport,
  type ReferralGraphCameraSnapshot,
} from '../referral-graph-viewport';

const camera: ReferralGraphCameraSnapshot = {
  scale: 1, panX: 0, panY: 0, width: 360, height: 520,
};
const rect = { x: 10, y: 20, width: 100, height: 60 };

describe('continuous graph label camera', () => {
  const point = { x: 1100, y: 810 };
  const label = { offsetX: -55, offsetY: 12, width: 110, height: 36 };
  it.each([0.04, 0.14, 1, 6])('keeps the whole label attached during pan/pinch from layout scale %s', (layoutScale) => {
    const base = projectReferralGraphPoint(point, layoutScale, 0, 0, camera.width, camera.height);
    for (const liveScale of [0.04, 0.14, 0.51, 1, 1.4, 6]) {
      const ratio = getReferralGraphLabelScale(liveScale, layoutScale);
      const live = { ...camera, scale: liveScale, panX: 173, panY: -91 };
      const result = getReferralGraphLabelRect(point, label, layoutScale, live);
      expect(ratio).toBeGreaterThan(0);
      // Independent composition of one center-scale and one live pan transform.
      expect(result.x).toBeCloseTo(camera.width / 2 + (base.x + label.offsetX - camera.width / 2) * ratio + live.panX, 8);
      expect(result.y).toBeCloseTo(camera.height / 2 + (base.y + label.offsetY - camera.height / 2) * ratio + live.panY, 8);
      expect(result.width).toBeCloseTo(label.width * ratio, 8);
      expect(result.height).toBeCloseTo(label.height * ratio, 8);
    }
  });

  it('does not jump when the pan crosses a culling refresh boundary', () => {
    const scale = 0.42;
    const before = getReferralGraphLabelRect(point, label, scale, { ...camera, scale, panX: 95 });
    const after = getReferralGraphLabelRect(point, label, scale, { ...camera, scale, panX: 97 });
    expect(after.x - before.x).toBeCloseTo(2, 8);
    expect(after.y).toBe(before.y);
  });

  it('keeps an enlarged label whose anchor is outside but whose text still reaches the screen', () => {
    const enlarged = getReferralGraphLabelRect({ x: 700, y: 900 }, { offsetX: 0, offsetY: 0, width: 150, height: 36 }, 0.1, { ...camera, scale: 1 });
    expect(enlarged.x).toBeLessThan(0);
    expect(isReferralGraphLabelVisible(enlarged, camera.width, camera.height, 0)).toBe(true);
    expect(isReferralGraphLabelVisible({ x: -200, y: 0, width: 199, height: 20 }, camera.width, camera.height, 0)).toBe(false);
    expect(getReferralGraphLabelScale(NaN, 0)).toBe(1);
  });
});

describe('referral graph viewport culling', () => {
  it.each([0.04, 0.25, 1, 1.4, 6])('inverts screen projection at scale %s', (scale) => {
    const snapshot = { ...camera, scale, panX: 173, panY: -91 };
    const bounds = getReferralGraphViewportWorldRect(snapshot, 160);
    const topLeft = projectReferralGraphPoint(bounds, scale, snapshot.panX, snapshot.panY,
      snapshot.width, snapshot.height);
    const bottomRight = projectReferralGraphPoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height },
      scale, snapshot.panX, snapshot.panY, snapshot.width, snapshot.height);
    expect(topLeft.x).toBeCloseTo(-160, 8);
    expect(topLeft.y).toBeCloseTo(-160, 8);
    expect(bottomRight.x).toBeCloseTo(snapshot.width + 160, 8);
    expect(bottomRight.y).toBeCloseTo(snapshot.height + 160, 8);
  });

  it('retains boundary points and padding for a hit target or large label', () => {
    expect(isReferralGraphPointInRect({ x: 10, y: 20 }, rect)).toBe(true);
    expect(isReferralGraphPointInRect({ x: 110, y: 80 }, rect)).toBe(true);
    expect(isReferralGraphPointInRect({ x: 111, y: 80 }, rect)).toBe(false);
    expect(isReferralGraphPointInRect({ x: 134, y: 80 }, rect, 24)).toBe(true);
    expect(isReferralGraphPointInRect({ x: 351, y: 80 }, rect, 240)).toBe(false);
    expect(isReferralGraphPointInRect({ x: 350, y: 80 }, rect, 240)).toBe(true);
  });

  it.each([
    [{ x: -40, y: 50 }, { x: 150, y: 50 }],
    [{ x: 50, y: -30 }, { x: 50, y: 130 }],
    [{ x: -10, y: 0 }, { x: 130, y: 140 }],
    [{ x: -10, y: 20 }, { x: 150, y: 20 }],
    [{ x: 0, y: 30 }, { x: 20, y: 10 }],
  ])('retains crossing or tangent segment %j → %j in both directions', (source, target) => {
    expect(isReferralGraphPointInRect(source, rect)).toBe(false);
    expect(isReferralGraphPointInRect(target, rect)).toBe(false);
    expect(doesReferralGraphSegmentIntersectRect(source, target, rect)).toBe(true);
    expect(doesReferralGraphSegmentIntersectRect(target, source, rect)).toBe(true);
  });

  it('rejects a diagonal whose bounding box overlaps but whose line misses the viewport', () => {
    expect(doesReferralGraphSegmentIntersectRect({ x: 0, y: 25 }, { x: 15, y: 10 }, rect)).toBe(false);
    expect(doesReferralGraphSegmentIntersectRect({ x: 0, y: 19 }, { x: 150, y: 19 }, rect)).toBe(false);
    expect(doesReferralGraphSegmentIntersectRect({ x: 9, y: 0 }, { x: 9, y: 100 }, rect)).toBe(false);
  });

  it('handles points, zero length edges, and stroke padding at a boundary', () => {
    expect(doesReferralGraphSegmentIntersectRect({ x: 10, y: 20 }, { x: 10, y: 20 }, rect)).toBe(true);
    expect(doesReferralGraphSegmentIntersectRect({ x: 9, y: 20 }, { x: 9, y: 20 }, rect)).toBe(false);
    expect(doesReferralGraphSegmentIntersectRect({ x: 0, y: 19 }, { x: 150, y: 19 }, rect, 1)).toBe(true);
  });

  it('never rejects a segment with a sampled point inside the viewport', () => {
    // Deterministic broad topology, independent of the production clipping algorithm.
    for (let index = 0; index < 200; index += 1) {
      const source = { x: (index * 53) % 241 - 60, y: (index * 97) % 201 - 60 };
      const target = { x: (index * 113 + 7) % 241 - 60, y: (index * 31 + 11) % 201 - 60 };
      for (let step = 0; step <= 40; step += 1) {
        const x = source.x + (target.x - source.x) * step / 40;
        const y = source.y + (target.y - source.y) * step / 40;
        if (x >= 10 && x <= 110 && y >= 20 && y <= 80) {
          expect(doesReferralGraphSegmentIntersectRect(source, target, rect)).toBe(true);
          break;
        }
      }
    }
  });
});

describe('referral graph camera snapshot refresh', () => {
  it('keeps small pans local and refreshes before mounted overscan is exhausted', () => {
    expect(shouldRefreshReferralGraphViewport(camera, camera)).toBe(false);
    expect(shouldRefreshReferralGraphViewport(camera, { ...camera, panX: 80 })).toBe(false);
    expect(shouldRefreshReferralGraphViewport(camera, { ...camera, panX: 81 })).toBe(true);
    expect(shouldRefreshReferralGraphViewport(camera, { ...camera, panY: -81 })).toBe(true);
    expect(shouldRefreshReferralGraphViewport({ ...camera, scale: 0.04 },
      { ...camera, scale: 0.04, panX: 81 })).toBe(true);
  });

  it('refreshes meaningful zoom, size changes, and an invalid initial scale', () => {
    expect(shouldRefreshReferralGraphViewport(camera, { ...camera, scale: 1.05 })).toBe(false);
    expect(shouldRefreshReferralGraphViewport(camera, { ...camera, scale: 1.11 })).toBe(true);
    expect(shouldRefreshReferralGraphViewport(camera, { ...camera, scale: 0.89 })).toBe(true);
    expect(shouldRefreshReferralGraphViewport(camera, { ...camera, width: 520, height: 360 })).toBe(true);
    expect(shouldRefreshReferralGraphViewport({ ...camera, scale: 0 }, camera)).toBe(true);
  });

  it('accounts for large font labels when a small zoom out expands their world footprint', () => {
    const next = { ...camera, scale: 0.95 };
    expect(shouldRefreshReferralGraphViewport(camera, next, 160, 1.1, 0)).toBe(false);
    expect(shouldRefreshReferralGraphViewport(camera, next, 160, 1.1, 1600)).toBe(true);
  });

  it('keeps every potentially visible padded primitive in the mounted bounds until refresh', () => {
    for (const scale of [0.04, 0.25, 1, 6]) {
      for (const primitivePadding of [24, 120, 360]) {
        const previous = { ...camera, scale, panX: 173, panY: -91 };
        const mounted = getReferralGraphViewportWorldRect(previous, 160 + primitivePadding);
        for (const ratio of [0.92, 0.98, 1, 1.05, 1.09]) {
          for (const pan of [-100, -40, 0, 40, 100]) {
            const next = { ...previous, scale: scale * ratio, panX: previous.panX + pan, panY: previous.panY - pan };
            if (shouldRefreshReferralGraphViewport(previous, next, 160, 1.1, primitivePadding)) continue;
            const visible = getReferralGraphViewportWorldRect(next, primitivePadding);
            expect(isReferralGraphPointInRect(visible, mounted)).toBe(true);
            expect(isReferralGraphPointInRect({ x: visible.x + visible.width, y: visible.y + visible.height }, mounted)).toBe(true);
          }
        }
      }
    }
  });
});
