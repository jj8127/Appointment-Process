import assert from 'node:assert/strict';
import test from 'node:test';

import { getReferralGraphLabelPresentation } from './referral-graph-display.ts';

test('getReferralGraphLabelPresentation keeps ordinary labels readable in overview zoom', () => {
  const label = getReferralGraphLabelPresentation({
    globalScale: 0.9,
    isSelected: false,
    isSearchMatch: false,
    isHighlighted: false,
    linkCount: 0,
  });

  assert.equal(label.visible, true);
  assert.ok(label.alpha >= 0.36, `ordinary overview labels should be readable, got ${label.alpha}`);
  assert.ok(label.alpha <= 0.5, `ordinary overview labels should not overpower nodes, got ${label.alpha}`);
});

test('getReferralGraphLabelPresentation keeps important labels readable before full label zoom', () => {
  const label = getReferralGraphLabelPresentation({
    globalScale: 1.25,
    isSelected: false,
    isSearchMatch: false,
    isHighlighted: false,
    linkCount: 7,
  });

  assert.equal(label.visible, true);
  assert.ok(label.alpha >= 0.68, `expected readable hub label, got ${label.alpha}`);
  assert.equal(label.fontWeight, 600);
});

test('getReferralGraphLabelPresentation always shows selected labels with code detail', () => {
  const label = getReferralGraphLabelPresentation({
    globalScale: 0.7,
    isSelected: true,
    isSearchMatch: false,
    isHighlighted: false,
    linkCount: 0,
  });

  assert.equal(label.visible, true);
  assert.equal(label.showCode, true);
  assert.equal(label.alpha, 1);
});

test('getReferralGraphLabelPresentation keeps code detail off regular labels even when zoomed in', () => {
  const label = getReferralGraphLabelPresentation({
    globalScale: 3,
    isSelected: false,
    isSearchMatch: false,
    isHighlighted: false,
    linkCount: 2,
  });

  assert.equal(label.visible, true);
  assert.equal(label.showCode, false);
});
