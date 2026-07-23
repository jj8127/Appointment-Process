import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_NOTIFICATION_WARNING_MESSAGE,
  getAdminNotificationWarning,
} from './admin-notification-warning.ts';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath: string) =>
  readFileSync(path.join(sourceRoot, relativePath), 'utf8');

test('maps the notification delivery warning code to a safe fixed message', () => {
  assert.equal(
    getAdminNotificationWarning({ warning: 'notification_delivery_incomplete' }),
    ADMIN_NOTIFICATION_WARNING_MESSAGE,
  );
});

test('does not expose a server action warning payload', () => {
  assert.equal(
    getAdminNotificationWarning({ warning: 'provider-specific delivery detail' }),
    ADMIN_NOTIFICATION_WARNING_MESSAGE,
  );
});

test('ignores missing, blank, and malformed warnings', () => {
  assert.equal(getAdminNotificationWarning(null), null);
  assert.equal(getAdminNotificationWarning({}), null);
  assert.equal(getAdminNotificationWarning({ warning: '   ' }), null);
  assert.equal(getAdminNotificationWarning({ warning: true }), null);
});

test('admin mutation callers render post-commit notification warnings', () => {
  const dashboardSource = readSource('app/dashboard/page.tsx');
  const appointmentSource = readSource('app/dashboard/appointment/page.tsx');
  const docsSource = readSource('app/dashboard/docs/page.tsx');
  const profileSource = readSource('app/dashboard/profile/[id]/page.tsx');

  assert.ok((dashboardSource.match(/getAdminNotificationWarning\(/g) ?? []).length >= 8);
  assert.equal((appointmentSource.match(/getAdminNotificationWarning\(/g) ?? []).length, 2);
  assert.equal((docsSource.match(/getAdminNotificationWarning\(/g) ?? []).length, 1);
  assert.equal((profileSource.match(/getAdminNotificationWarning\(/g) ?? []).length, 1);

  for (const source of [dashboardSource, appointmentSource, docsSource, profileSource]) {
    assert.match(source, /ADMIN_NOTIFICATION_WARNING_TITLE/);
    assert.match(source, /color:\s*'yellow'/);
  }
});
