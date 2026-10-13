import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const repositoryRoot = path.resolve(webRoot, '..');
const routeSource = readFileSync(
  path.join(
    webRoot,
    'src/app/api/cron/messenger-attachment-cleanup/route.ts',
  ),
  'utf8',
);

function loadRoute(payload: unknown, status = 200) {
  const code = ts.transpileModule(routeSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(code, {
    AbortSignal,
    exports,
    fetch: async () => ({
      ok: status >= 200 && status < 300,
      json: async () => payload,
    }),
    process: {
      env: {
        CRON_SECRET: 'synthetic-cron-secret',
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-role',
      },
    },
    require: (id: string) => {
      if (id === 'next/server') {
        return { NextResponse: { json: (body: unknown, options?: { status?: number }) => ({ body, status: options?.status ?? 200 }) } };
      }
      throw new Error(`Unexpected cleanup route dependency ${id}`);
    },
  });
  return exports.GET as (request: Request) => Promise<{ body: unknown; status: number }>;
}

const cronRequest = () => new Request('https://admin.example/api/cron/messenger-attachment-cleanup', {
  headers: { authorization: 'Bearer synthetic-cron-secret' },
});

test('scheduled attachment cleanup requires the dedicated cron secret', () => {
  assert.match(routeSource, /process\.env\.CRON_SECRET/);
  assert.match(
    routeSource,
    /request\.headers\.get\('authorization'\) !== `Bearer \$\{cronSecret\}`/,
  );
  assert.match(routeSource, /!cronSecret/);
});

test('scheduled cleanup calls only the service-authenticated maintenance action', () => {
  assert.match(
    routeSource,
    /\/functions\/v1\/messenger-attachments/,
  );
  assert.match(routeSource, /apikey: serviceRoleKey/);
  assert.match(routeSource, /Authorization: `Bearer \$\{serviceRoleKey\}`/);
  assert.match(
    routeSource,
    /JSON\.stringify\(\{ type: 'cleanup_drain', limit: 100 \}\)/,
  );
  assert.doesNotMatch(routeSource, /notificationWarning|cleanupWarning/);
});

test('scheduled cleanup rejects malformed success counters instead of reporting zeros', async () => {
  for (const payload of [
    { ok: true },
    { ok: true, expired: -1, claimed: 0, removed: 0, requeued: 0, exhausted: 0 },
    { ok: true, expired: 0, claimed: 0, removed: 0, requeued: 0, exhausted: '0' },
  ]) {
    const response = await loadRoute(payload)(cronRequest());
    assert.equal(response.status, 503);
    assert.equal(JSON.stringify(response.body), JSON.stringify({ ok: false, code: 'cleanup_upstream_failed' }));
  }

  const counts = { expired: 1, claimed: 2, removed: 3, requeued: 4, exhausted: 5 };
  const response = await loadRoute({ ok: true, ...counts })(cronRequest());
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(response.body), JSON.stringify({ ok: true, ...counts }));
});

test('both supported Vercel project roots schedule the cleanup route', () => {
  for (
    const configPath of [
      path.join(repositoryRoot, 'vercel.json'),
      path.join(webRoot, 'vercel.json'),
    ]
  ) {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    assert.deepEqual(config.crons, [{
      path: '/api/cron/messenger-attachment-cleanup',
      schedule: '*/5 * * * *',
    }]);
  }
});
