import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
