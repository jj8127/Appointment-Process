import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('dashboard navigation exposes referral graph as a top-level staff menu item', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(testDir, '../app/dashboard/layout.tsx'), 'utf8');

  assert.match(source, /IconGraph/);
  assert.match(
    source,
    /\{\s*label:\s*'추천인 그래프',\s*icon:\s*IconGraph,\s*href:\s*'\/dashboard\/referrals\/graph'\s*\}/,
  );
});
