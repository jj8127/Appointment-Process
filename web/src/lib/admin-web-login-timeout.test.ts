import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_WEB_LOGIN_BROWSER_TIMEOUT_MS,
  ADMIN_WEB_LOGIN_UPSTREAM_TIMEOUT_MS,
  isAdminWebLoginTimeout,
} from './admin-web-login-timeout.ts';

test('admin web login timeouts leave room for the API to return a friendly response', () => {
  assert.ok(ADMIN_WEB_LOGIN_UPSTREAM_TIMEOUT_MS > 0);
  assert.ok(ADMIN_WEB_LOGIN_BROWSER_TIMEOUT_MS > ADMIN_WEB_LOGIN_UPSTREAM_TIMEOUT_MS);
});

test('admin web login timeout detection handles browser and wrapped Supabase aborts', () => {
  assert.equal(isAdminWebLoginTimeout({ name: 'TimeoutError' }), true);
  assert.equal(
    isAdminWebLoginTimeout({ name: 'FunctionsFetchError', context: { name: 'AbortError' } }),
    true,
  );
  assert.equal(isAdminWebLoginTimeout({ name: 'FunctionsHttpError' }), false);
  assert.equal(isAdminWebLoginTimeout(new Error('invalid credentials')), false);
});
