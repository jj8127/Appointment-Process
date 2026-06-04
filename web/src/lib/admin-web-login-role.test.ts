import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAdminWebLoginRole } from './admin-web-login-role.ts';

test('resolveAdminWebLoginRole only accepts explicit server roles', () => {
  assert.equal(resolveAdminWebLoginRole('admin'), 'admin');
  assert.equal(resolveAdminWebLoginRole('manager'), 'manager');
  assert.equal(resolveAdminWebLoginRole('fc'), 'fc');

  assert.equal(resolveAdminWebLoginRole('developer'), null);
  assert.equal(resolveAdminWebLoginRole(undefined), null);
  assert.equal(resolveAdminWebLoginRole(null), null);
  assert.equal(resolveAdminWebLoginRole(''), null);
});
