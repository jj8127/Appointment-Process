import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { testEnvironment } from '../../../scripts/ci/run-discovered-tests.mjs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const web = path.join(repository, 'web');

test('Next keeps repository shared sources inside its root when Vercel supplies a narrower tracing root', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const loadConfig = require('next/dist/server/config').default;
    loadConfig('phase-production-build', process.cwd(), { silent: true }).then(config => {
      console.log('CONFIG_ROOTS=' + JSON.stringify({
        tracing: config.outputFileTracingRoot,
        turbo: config.turbopack.root,
      }));
    }).catch(() => { process.exitCode = 1; });
  `], {
    cwd: web,
    env: { ...testEnvironment(), NEXT_PRIVATE_OUTPUT_TRACE_ROOT: web, NEXT_TELEMETRY_DISABLED: '1' },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  assert.equal(result.status, 0, 'the actual Next configuration must load');
  const line = result.stdout.split(/\r?\n/).find(value => value.startsWith('CONFIG_ROOTS='));
  assert.ok(line, 'Next must report normalized roots');
  const roots = JSON.parse(line.slice('CONFIG_ROOTS='.length));
  assert.equal(path.resolve(roots.tracing), path.resolve(repository));
  assert.equal(path.resolve(roots.turbo), path.resolve(repository));
  for (const source of [
    'supabase/functions/_shared/request-board-auth.ts',
    'supabase/functions/_shared/session-generation.ts',
    'lib/referral-allowance-calculation.ts',
    'types/referral-allowance.ts',
  ]) {
    const fullPath = path.join(repository, source);
    assert.ok(existsSync(fullPath), `shared build source exists: ${source}`);
    assert.ok(!path.relative(roots.turbo, fullPath).startsWith('..'), `shared source is inside the build root: ${source}`);
  }
});
