import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  normalizeAdminTempId,
  resolveAdminTempIdUpdate,
} from './admin-temp-id-update.ts';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath: string) =>
  readFileSync(path.join(sourceRoot, relativePath), 'utf8');

test('normalizes blank and padded temporary IDs', () => {
  assert.equal(normalizeAdminTempId('  TEMP-01  '), 'TEMP-01');
  assert.equal(normalizeAdminTempId('   '), null);
  assert.equal(normalizeAdminTempId(null), null);
});

test('treats equivalent normalized temporary IDs as unchanged', () => {
  assert.deepEqual(resolveAdminTempIdUpdate('TEMP-01', '  TEMP-01 '), {
    changed: false,
    currentTempId: 'TEMP-01',
    nextTempId: 'TEMP-01',
  });
});

test('detects issue, replacement, and removal changes', () => {
  assert.equal(resolveAdminTempIdUpdate(null, 'TEMP-01').changed, true);
  assert.equal(resolveAdminTempIdUpdate('TEMP-01', 'TEMP-02').changed, true);
  assert.equal(resolveAdminTempIdUpdate('TEMP-01', '').changed, true);
});

test('client and server both guard temporary ID notifications with a value comparison', () => {
  const profileSource = readSource('app/dashboard/profile/[id]/page.tsx');
  const routeSource = readSource('app/api/admin/fc/route.ts');

  assert.match(profileSource, /resolveAdminTempIdUpdate\(profile\?\.temp_id, values\.temp_id\)/);
  assert.match(profileSource, /if \(tempIdUpdate\.changed\)/);
  assert.match(routeSource, /\.select\('status,temp_id'\)/);
  assert.match(routeSource, /resolveAdminTempIdUpdate\(currentProfile\?\.temp_id, updateData\.temp_id\)/);
  assert.match(routeSource, /if \(updateData\.status === 'temp-id-issued'\) \{\s*delete updateData\.status/);
  assert.match(routeSource, /const shouldNotifyTemp = tempIdChanged && Boolean\(nextTempId\)/);
});
