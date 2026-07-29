import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifestSource = readFileSync(new URL('../app/manifest.ts', import.meta.url), 'utf8');
const serviceWorkerSource = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const registrarSource = readFileSync(
  new URL('../components/PwaServiceWorkerRegistrar.tsx', import.meta.url),
  'utf8',
);
const layoutSource = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');

test('administrator PWA manifest uses the deployed HTTPS app scope and branded square icon', () => {
  assert.match(manifestSource, /name:\s*'가람in 관리자'/);
  assert.match(manifestSource, /start_url:\s*'\/auth'/);
  assert.match(manifestSource, /scope:\s*'\/'/);
  assert.match(manifestSource, /display:\s*'standalone'/);
  assert.match(manifestSource, /lang:\s*'ko-KR'/);
  assert.match(manifestSource, /src:\s*'\/store-icon\.png'/);
  assert.match(manifestSource, /sizes:\s*'2475x2475'/);
  assert.match(manifestSource, /purpose:\s*'any'/);
});

test('administrator service worker stays network-only and never caches authenticated data', () => {
  assert.match(serviceWorkerSource, /event\.respondWith\(fetch\(request\)\)/);
  assert.match(serviceWorkerSource, /request\.mode === 'navigate'/);
  assert.match(serviceWorkerSource, /'Cache-Control': 'no-store'/);
  assert.doesNotMatch(serviceWorkerSource, /\bcaches\.(?:open|match|keys|delete)\b/);
  assert.doesNotMatch(serviceWorkerSource, /\bCacheStorage\b/);
});

test('production secure contexts register the service worker without cached updates', () => {
  assert.match(registrarSource, /process\.env\.NODE_ENV !== 'production'/);
  assert.match(registrarSource, /window\.isSecureContext/);
  assert.match(registrarSource, /navigator\.serviceWorker\.register\('\/sw\.js'/);
  assert.match(registrarSource, /updateViaCache:\s*'none'/);
  assert.match(layoutSource, /PwaServiceWorkerRegistrar/);
  assert.match(layoutSource, /name="theme-color"/);
  assert.doesNotMatch(layoutSource, /rel="manifest"/);
});
