import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath: string) =>
  readFileSync(path.join(sourceRoot, relativePath), 'utf8');

test('server-side Expo sends have a bounded post-commit request deadline', () => {
  const lifecycleSource = readSource('lib/push-notification-service.ts');
  const noticeSource = readSource('app/dashboard/notifications/actions.ts');

  for (const source of [lifecycleSource, noticeSource]) {
    assert.match(source, /const EXTERNAL_PUSH_TIMEOUT_MS = 8_000/);
    assert.match(source, /signal: AbortSignal\.timeout\(EXTERNAL_PUSH_TIMEOUT_MS\)/);
  }
});

test('web push sends run concurrently with a per-request socket timeout', () => {
  const source = readSource('lib/web-push.ts');

  assert.match(source, /const WEB_PUSH_TIMEOUT_MS = 8_000/);
  assert.match(source, /Promise\.all\(subscriptions\.map\(async \(sub\)/);
  assert.match(source, /\{ timeout: WEB_PUSH_TIMEOUT_MS \}/);
  assert.doesNotMatch(source, /for \(const sub of subscriptions\)/);
});
