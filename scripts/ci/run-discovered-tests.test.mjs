import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { discoverTests, runSuite, testEnvironment } from './run-discovered-tests.mjs';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'garamin-ci-discovery-'));
  for (const dir of ['web/src', 'supabase/functions', 'supabase/tests', 'scripts']) mkdirSync(join(root, dir), { recursive: true });
  for (const [name, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), source);
  }
  return root;
}
const nodeSource = "import test from 'node:test'; test('fixture',()=>{});";
test('discovers all requested filename forms and separates Node, Deno, Jest, and SQL', () => {
  const root = fixture({
    'web/src/a.test.ts': nodeSource, 'web/src/b.test.node.ts': nodeSource, 'web/src/nested/c.test.mjs': nodeSource,
    'web/scripts/fixtures/d.test.mjs': nodeSource,
    'supabase/functions/a_test.ts': nodeSource, 'supabase/functions/b_test.ts': "Deno.test('fixture',()=>{});",
    'supabase/functions/c.test.ts': "describe('jest',()=>{it('works',()=>{});});", 'scripts/ci/a.test.mjs': nodeSource,
    'supabase/tests/a.test.mjs': nodeSource, 'supabase/tests/b-postgres.test.mjs': nodeSource,
    'web/src/node_modules/ignored.test.ts': 'invalid', 'web/.next/ignored.test.ts': 'invalid',
  });
  try {
    const groups = discoverTests(root);
    assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.length])), {
      'web-node': 4, 'edge-node': 1, 'tools-node': 1, 'edge-deno': 1, 'sql-pglite': 1, 'sql-postgres': 1, jest: 1, 'manual-live': 0,
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('new matching files cannot silently remain unassigned', () => {
  const root = fixture({ 'web/src/unknown.test.node.ts': 'export const noTests = true;' });
  try { assert.throws(() => discoverTests(root), /Unassigned test runtime/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
test('a mixed runtime and an empty requested suite fail closed', () => {
  const root = fixture({ 'supabase/functions/mixed_test.ts': `${nodeSource}\nDeno.test('fixture',()=>{});` });
  try { assert.throws(() => discoverTests(root), /Ambiguous/); }
  finally { rmSync(root, { recursive: true, force: true }); }
  const empty = fixture({});
  try { assert.throws(() => runSuite('web-node', { root: empty }), /No tests/); }
  finally { rmSync(empty, { recursive: true, force: true }); }
});
test('child environments omit credentials, dotenv injection, and inherited Node options', () => {
  const env = testEnvironment({ PATH: 'fixture-path', HOME: 'fixture-home', SENTRY_READ_AUTH_TOKEN: 'fixture',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture', NODE_OPTIONS: '--env-file=.env', DATABASE_URL: 'fixture' });
  assert.equal(env.PATH, 'fixture-path');
  for (const key of ['SENTRY_READ_AUTH_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'NODE_OPTIONS', 'DATABASE_URL']) assert.equal(key in env, false);
  assert.equal(env.SENTRY_AUTH_TOKEN, '');
});
test('default network boundary prevents fetch, HTTP, and raw TCP before connection', () => {
  const preload = new URL('./test-network-boundary.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--import', preload, '--input-type=module', '-e',
    "import http from 'node:http'; import net from 'node:net'; const calls=[()=>fetch('https://example.invalid'),()=>http.get('http://example.invalid'),()=>net.connect(5432,'127.0.0.1')]; for(const call of calls){try{call();process.exit(2)}catch(e){if(!e.message.includes('network is disabled'))process.exit(3)}}"],
  { env: testEnvironment(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
test('current inventory includes Node-only web suffixes and Edge underscore tests', () => {
  const groups = discoverTests();
  assert.ok(groups['web-node'].some(file => file.endsWith('.test.node.ts')));
  assert.ok(groups['web-node'].some(file => file.endsWith('.test.mjs')));
  assert.ok(groups['edge-node'].some(file => file.endsWith('_test.ts')));
  assert.ok(groups['edge-deno'].every(file => file.endsWith('_test.ts')));
  assert.ok(groups['sql-postgres'].includes('supabase/tests/session-generation-postgres.test.mjs'));
  assert.deepEqual(groups['manual-live'], ['web/src/lib/referral-graph-realdata.test.ts']);
  assert.throws(() => runSuite('manual-live'), /known test suite/);
});
