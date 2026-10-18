import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReferralNeighborIndex, easeTowards, OBSIDIAN_DIM_ALPHA, referralHoverNodeAlpha, referralLabelAlpha,
} from './referral-graph-obsidian-view.ts';

test('neighbor index links both directions, accepts resolved endpoints and ignores self links', () => {
  const index = buildReferralNeighborIndex([
    { source: 'a', target: 'b' }, { source: { id: 'b' }, target: { id: 'c' } }, { source: 'c', target: 'c' },
  ]);
  assert.deepEqual([...index.get('b')!].sort(), ['a', 'c']);
  assert.deepEqual([...index.get('a')!], ['b']);
  assert.deepEqual([...index.get('c')!], ['b']);
});

test('labels fade out below a readable size instead of shrinking to unreadable text', () => {
  assert.equal(referralLabelAlpha(3), 0);
  assert.equal(referralLabelAlpha(5), 0);
  assert.equal(referralLabelAlpha(7), 0.5);
  assert.equal(referralLabelAlpha(12), 1);
  assert.equal(referralLabelAlpha(Number.NaN), 0);
});

test('hover keeps the focus set opaque and dims everything else to the Obsidian level', () => {
  assert.equal(referralHoverNodeAlpha(true, 1), 1);
  assert.equal(referralHoverNodeAlpha(false, 0), 1);
  assert.ok(Math.abs(referralHoverNodeAlpha(false, 1) - OBSIDIAN_DIM_ALPHA) < 1e-9);
  assert.ok(Math.abs(referralHoverNodeAlpha(false, 0.5) - 0.6) < 1e-9);
});

test('easing is frame-rate independent and snaps when close', () => {
  const twoSmall = easeTowards(easeTowards(0, 1, 1000 / 60), 1, 1000 / 60);
  const oneLarge = easeTowards(0, 1, 2000 / 60);
  assert.ok(Math.abs(twoSmall - oneLarge) < 1e-9);
  assert.equal(easeTowards(0.9999, 1, 16), 1);
  assert.ok(easeTowards(0, 1, 800) > 0.94);
  assert.ok(easeTowards(0, 1, 300) < 0.8);
});
