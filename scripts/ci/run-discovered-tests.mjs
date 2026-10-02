import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const formats = /(?:\.test(?:\.node)?\.(?:ts|mjs)|_test\.ts)$/;
export const suites = ['web-node', 'edge-node', 'tools-node', 'edge-deno', 'sql-pglite', 'sql-postgres'];
export const manualOnlyTests = {
  'web/src/lib/referral-graph-realdata.test.ts': 'Reads real customer referral data using local service credentials; requires separate explicit authorization and is never run by CI.',
};

export function discoverTests(root = repository) {
  const groups = Object.fromEntries([...suites, 'jest', 'manual-live'].map(name => [name, []]));
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || ['node_modules', '.next', '.codex-tmp', 'out', 'coverage'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { visit(path); continue; }
      if (!entry.isFile() || !formats.test(entry.name)) continue;
      const file = relative(root, path).replaceAll('\\', '/');
      if (Object.hasOwn(manualOnlyTests, file)) { groups['manual-live'].push(file); continue; }
      const source = readFileSync(path, 'utf8');
      const node = /^import\s+[^;]*?\sfrom\s+['"]node:test['"]/m.test(source);
      const deno = /^\s*Deno\.test\s*\(/m.test(source);
      if (node && deno) throw new Error(`Ambiguous test runtime: ${file}`);
      let suite;
      if (file.startsWith('supabase/tests/')) {
        if (!node) throw new Error(`SQL test must use node:test: ${file}`);
        suite = file.endsWith('-postgres.test.mjs') ? 'sql-postgres' : 'sql-pglite';
      } else if (node) {
        suite = file.startsWith('web/') ? 'web-node' : file.startsWith('supabase/') ? 'edge-node' : 'tools-node';
      } else if (deno) suite = 'edge-deno';
      else if (/\.test\.ts$/.test(file) && /\b(?:describe|test|it)\s*\(/.test(source) && !file.startsWith('web/')) suite = 'jest';
      else throw new Error(`Unassigned test runtime: ${file}`);
      groups[suite].push(file);
    }
  }
  for (const folder of ['web', 'supabase/functions', 'supabase/tests', 'scripts']) visit(join(root, folder));
  for (const files of Object.values(groups)) files.sort();
  return groups;
}

export function testEnvironment(source = process.env) {
  const result = {};
  const allowed = /^(?:PATH|PATHEXT|SystemRoot|WINDIR|ComSpec|HOME|USERPROFILE|TEMP|TMP|TMPDIR|DENO_DIR|CI|TZ)$/i;
  for (const [key, value] of Object.entries(source)) if (allowed.test(key)) result[key] = value;
  return { ...result, SENTRY_AUTH_TOKEN: '', SENTRY_DSN: '', SENTRY_DISABLE_UPLOAD: '1', SENTRY_DISABLE_AUTO_UPLOAD: 'true' };
}

export function runSuite(suite, { root = repository, cacheDeno = false } = {}) {
  if (!suites.includes(suite)) throw new Error('Choose a known test suite.');
  const files = discoverTests(root)[suite];
  if (!files.length) throw new Error(`No tests discovered for ${suite}.`);
  const env = testEnvironment();
  let command = process.execPath;
  let args;
  if (suite === 'edge-deno') {
    command = 'deno';
    args = cacheDeno
      ? ['cache', '--frozen', '--config', 'supabase/functions/deno.json', ...files]
      : ['test', '--frozen', '--cached-only', '--no-prompt', '--deny-net', `--allow-read=${root}`, '--allow-env', '--config', 'supabase/functions/deno.json', ...files];
  } else {
    if (cacheDeno) throw new Error('Dependency caching is only supported for Deno.');
    if (suite.startsWith('sql-')) {
      const dependencyRoot = join(root, 'scripts/ci/fixtures/node_modules');
      env.PGLITE_MODULE_PATH = process.env.PGLITE_MODULE_PATH || join(dependencyRoot, '@electric-sql/pglite');
      env.PG_MODULE_PATH = process.env.PG_MODULE_PATH || join(dependencyRoot, 'pg');
      if (suite === 'sql-postgres') {
        const port = Number(process.env.CI_POSTGRES_PORT);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('CI_POSTGRES_PORT must name an explicit disposable loopback fixture.');
        env.OTP_TEST_POSTGRES_PORT = String(port);
        env.SESSION_TEST_POSTGRES_PORT = String(port);
        env.CI_TEST_LOOPBACK_POSTGRES_PORT = String(port);
      }
    }
    args = ['--experimental-strip-types', '--import', pathToFileURL(join(root, 'scripts/ci/test-network-boundary.mjs')).href, '--test', '--test-concurrency=1', '--test-timeout=120000', ...files];
  }
  console.log(JSON.stringify({ suite, files: files.length, mode: cacheDeno ? 'dependency-cache' : 'test', network: cacheDeno ? 'locked-dependencies-only' : suite === 'sql-postgres' ? 'explicit-loopback-postgres-only' : 'denied' }));
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 15 * 60 * 1000 });
  if (result.error) throw new Error(`Test process could not complete: ${result.error.code ?? 'unknown'}`);
  return result.status ?? 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv[2] === '--list') console.log(JSON.stringify({ suites: discoverTests(), manualOnlyTests }, null, 2));
    else process.exitCode = runSuite(process.argv[2], { cacheDeno: process.argv[3] === '--cache-deno' });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
