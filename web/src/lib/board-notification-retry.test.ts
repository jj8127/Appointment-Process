import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath: string) =>
  readFileSync(path.join(sourceRoot, relativePath), 'utf8');

test('board notification retry uses the dedicated allowlisted Edge function', () => {
  const proxy = readSource('lib/board-web-proxy.ts');
  const api = readSource('lib/board-api.ts');

  assert.match(proxy, /'board-notification-retry'/);
  assert.match(api, /'board-notification-retry'/);
  assert.match(api, /postId:\s*retry\.postId/);
  assert.match(api, /eventKey:\s*retry\.eventKey/);
});

test('board retry UI never replays the committed create or update mutation', () => {
  const page = readSource('app/dashboard/board/page.tsx');
  const retryBlock = page.match(
    /const retryNotificationMutation = useMutation\(\{([\s\S]*?)\n  \}\);/,
  )?.[1] ?? '';

  assert.match(retryBlock, /retryBoardNotification\(actor,\s*pendingNotificationRetry\)/);
  assert.doesNotMatch(retryBlock, /createBoardPost/);
  assert.doesNotMatch(retryBlock, /updateBoardPost/);
  assert.match(page, /알림만 다시 시도/);
});

test('provider and no-device outcomes clear the retry token after inbox persistence', () => {
  const api = readSource('lib/board-api.ts');

  assert.match(
    api,
    /notificationStored === false && payload\.notificationRetry/,
  );
  assert.match(
    api,
    /notificationStored === false[\s\S]*notificationWarning/,
  );
});
