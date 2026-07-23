import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  getAdminNotificationWarning,
} from './admin-notification-warning.ts';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath: string) =>
  readFileSync(path.join(sourceRoot, relativePath), 'utf8');

test('keeps notification delivery diagnostics out of operator-facing feedback', () => {
  assert.equal(
    getAdminNotificationWarning({ warning: 'notification_delivery_incomplete' }),
    null,
  );
});

test('does not expose a server action warning payload', () => {
  assert.equal(
    getAdminNotificationWarning({ warning: 'provider-specific delivery detail' }),
    null,
  );
});

test('ignores missing, blank, and malformed warnings', () => {
  assert.equal(getAdminNotificationWarning(null), null);
  assert.equal(getAdminNotificationWarning({}), null);
  assert.equal(getAdminNotificationWarning({ warning: '   ' }), null);
  assert.equal(getAdminNotificationWarning({ warning: true }), null);
});

test('admin mutation callers route post-commit diagnostics through the hidden warning adapter', () => {
  const dashboardSource = readSource('app/dashboard/page.tsx');
  const appointmentSource = readSource('app/dashboard/appointment/page.tsx');
  const docsSource = readSource('app/dashboard/docs/page.tsx');
  const profileSource = readSource('app/dashboard/profile/[id]/page.tsx');

  assert.ok((dashboardSource.match(/getAdminNotificationWarning\(/g) ?? []).length >= 8);
  assert.equal((appointmentSource.match(/getAdminNotificationWarning\(/g) ?? []).length, 2);
  assert.equal((docsSource.match(/getAdminNotificationWarning\(/g) ?? []).length, 1);
  assert.equal((profileSource.match(/getAdminNotificationWarning\(/g) ?? []).length, 1);

  const helperSource = readSource('lib/admin-notification-warning.ts');
  assert.doesNotMatch(helperSource, /변경사항은 저장되었지만/);
  assert.match(helperSource, /return null/);
});
