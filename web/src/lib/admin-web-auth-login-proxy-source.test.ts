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
  assert.match(loginRouteSource, /response\.cookies\.set/);
});
