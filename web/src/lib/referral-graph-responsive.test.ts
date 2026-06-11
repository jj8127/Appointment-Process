import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  assert.equal(layout.canvasMinHeight, 520);
  assert.equal(layout.shellHeight, 'calc(100dvh - 64px)');
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

test('referral graph page keeps desktop copy and adds mobile-friendly controls', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    resolve(testDir, '../app/dashboard/referrals/graph/page.tsx'),
    'utf8',
  );

  assert.match(source, /const isMobileGraph = responsiveLayout\.mode === 'mobile'/);
  assert.match(source, /isMobileGraph \? '추천 관계 보기' : '추천인 그래프'/);
  assert.match(source, /isMobileGraph \? '범례' : '색상 범례'/);
  assert.match(source, /overflowX: isMobileGraph \? 'auto' : undefined/);
  assert.match(source, /추천인 그래프/);
});
