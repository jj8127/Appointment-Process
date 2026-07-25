import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeGroupChatProxyPayload } from './group-chat-web.ts';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath: string) =>
  readFileSync(path.join(sourceRoot, relativePath), 'utf8');

test('group chat proxy allows only a message id and retry token for notification retry', () => {
  assert.deepEqual(
    normalizeGroupChatProxyPayload({
      type: 'group_chat_notification_retry',
      message_id: 'message-1',
      retry_token: 'signed-token',
      content: 'must not be forwarded',
    }),
    {
      ok: true,
      payload: {
        type: 'group_chat_notification_retry',
        message_id: 'message-1',
        retry_token: 'signed-token',
      },
    },
  );
  assert.equal(
    normalizeGroupChatProxyPayload({
      type: 'group_chat_notification_retry',
      message_id: 'message-1',
    }).ok,
    false,
  );
});

test('group chat notification retry never replays the message send mutation', () => {
  const client = readSource('lib/group-chat-client.ts');
  const page = readSource('app/dashboard/group-chat/page.tsx');
  const retryHandler = page.match(
    /const handleRetryNotification = useCallback\(async \(retry:[\s\S]*?\n  \}, \[\]\);/,
  )?.[0] ?? '';

  assert.match(client, /type:\s*'group_chat_notification_retry'/);
  assert.match(client, /message_id:\s*retry\.messageId/);
  assert.match(client, /retry_token:\s*retry\.retryToken/);
  assert.match(retryHandler, /groupChatRetryNotification\(retry\)/);
  assert.doesNotMatch(retryHandler, /groupChatSend/);
});

test('group chat keeps retry only for inbox persistence failure', () => {
  const page = readSource('app/dashboard/group-chat/page.tsx');

  assert.match(
    page,
    /notification\.delivery\.notificationStored === false[\s\S]*result\.notificationRetry/,
  );
  assert.match(
    page,
    /result\.delivery\.notificationStored === true[\s\S]*filter\(\(pending\) => pending\.messageId !== retry\.messageId\)/,
  );
  assert.match(
    page,
    /요청은 처리됐지만 수신자 알림함에 등록하지 못했습니다\./,
  );
});
