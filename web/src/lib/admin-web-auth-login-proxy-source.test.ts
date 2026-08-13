import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('admin web login page uses the server proxy instead of calling the Supabase function in-browser', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const authPageSource = readFileSync(resolve(testDir, '../app/auth/page.tsx'), 'utf8');
  const loginRouteSource = readFileSync(resolve(testDir, '../app/api/auth/login/route.ts'), 'utf8');

  assert.match(authPageSource, /fetch\(\s*['"]\/api\/auth\/login['"]/);
  assert.doesNotMatch(authPageSource, /login-with-password/);
  assert.doesNotMatch(authPageSource, /supabase\.functions\.invoke/);

  assert.match(loginRouteSource, /functions\.invoke<LoginResponse>\(\s*['"]login-with-password['"]/);
  assert.match(loginRouteSource, /timeout:\s*ADMIN_WEB_LOGIN_UPSTREAM_TIMEOUT_MS/);
  assert.match(authPageSource, /signal:\s*AbortSignal\.timeout\(ADMIN_WEB_LOGIN_BROWSER_TIMEOUT_MS\)/);
  assert.match(loginRouteSource, /response\.cookies\.set/);
});

test('admin web login submits through a form and hard-navigates after the server session is created', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const authPageSource = readFileSync(resolve(testDir, '../app/auth/page.tsx'), 'utf8');

  assert.match(authPageSource, /component=["']form["']/);
  assert.match(authPageSource, /onSubmit=\{handleSubmit\}/);
  assert.match(authPageSource, /type=["']submit["']/);
  assert.match(authPageSource, /window\.location\.replace\(destination\)/);
  assert.doesNotMatch(authPageSource, /onClick=\{handleLogin\}/);
});
