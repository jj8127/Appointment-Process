import assert from 'node:assert/strict';
import test from 'node:test';

import { getReferralGraphResponsiveLayout } from './referral-graph-responsive.ts';

test('getReferralGraphResponsiveLayout keeps mobile graph controls compact and non-overlapping', () => {
  const layout = getReferralGraphResponsiveLayout(390);

  assert.equal(layout.mode, 'mobile');
  assert.equal(layout.headerStacked, true);
  assert.equal(layout.showLongDescription, false);
  assert.equal(layout.controlsScrollable, true);
  assert.equal(layout.statsScrollable, true);
  assert.equal(layout.legendPlacement, 'bottom-strip');
  assert.equal(layout.physicsPanelPlacement, 'bottom-sheet');
  assert.equal(layout.canvasMinHeight, 360);
  assert.equal(layout.shellHeight, 'calc(100dvh - 64px - 32px)');
});

test('getReferralGraphResponsiveLayout gives tablets a compact header but keeps the floating settings panel', () => {
  const layout = getReferralGraphResponsiveLayout(820);

  assert.equal(layout.mode, 'tablet');
  assert.equal(layout.headerStacked, true);
  assert.equal(layout.controlsScrollable, true);
  assert.equal(layout.legendPlacement, 'floating');
  assert.equal(layout.physicsPanelPlacement, 'floating');
  assert.equal(layout.physicsPanelWidth, 320);
  assert.equal(layout.canvasMinHeight, 460);
});

test('getReferralGraphResponsiveLayout keeps desktop graph controls inline', () => {
  const layout = getReferralGraphResponsiveLayout(1280);

  assert.equal(layout.mode, 'desktop');
  assert.equal(layout.headerStacked, false);
  assert.equal(layout.showLongDescription, true);
  assert.equal(layout.controlsScrollable, false);
  assert.equal(layout.statsScrollable, false);
  assert.equal(layout.legendPlacement, 'floating');
  assert.equal(layout.physicsPanelPlacement, 'floating');
  assert.equal(layout.physicsPanelWidth, 340);
  assert.equal(layout.canvasMinHeight, 560);
});
