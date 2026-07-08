import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));

describe('web-push auto-registration policy', () => {
  it('keeps public admin web route detection in the auto-registration policy', () => {
    const source = readFileSync(resolve(testDir, 'web-push-registration-policy.ts'), 'utf8');

    assert.match(source, /isAdminWebPublicPath\(pathname\)/);
    assert.match(source, /return Boolean\(role && residentId\)/);
  });

  it('requires WebPushRegistrar to use the route-aware policy before calling the subscribe API', () => {
    const source = readFileSync(resolve(testDir, '../components/WebPushRegistrar.tsx'), 'utf8');

    assert.match(source, /usePathname\(/);
    assert.match(source, /shouldAutoRegisterWebPush\(\{ pathname, role, residentId \}\)/);
    assert.doesNotMatch(source, /if \(!role \|\| !residentId\) return;/);
  });
});
