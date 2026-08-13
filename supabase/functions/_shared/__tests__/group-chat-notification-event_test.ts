/// <reference lib="deno.ns" />

import {
  assertEquals,
  assertRejects,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  deriveGroupChatNotificationEventKey,
  groupChatNotificationDeliveryKey,
  isGroupChatNotificationEventKey,
  isGroupChatNotificationRetryToken,
  issueGroupChatNotificationRetryToken,
  verifyGroupChatNotificationRetryToken,
} from '../group-chat-notification-event.ts';

const input = {
  roomId: '018f2fc0-9b3d-7c48-8973-88bb28d03a22',
  messageId: '018f2fc0-9b3d-7c48-8973-88bb28d03a23',
  senderActorId: 'manager:01012345678',
  createdAt: '2026-07-25T04:00:00.000Z',
};
const recipientActorId = '018f2fc0-9b3d-7c48-8973-88bb28d03a24';
const currentSecret = 'current-group-chat-retry-secret-0001';
const previousSecret = 'previous-group-chat-retry-secret-01';

Deno.test('group-chat notification retry event is stable for one committed message', async () => {
  const first = await deriveGroupChatNotificationEventKey(input);
  const second = await deriveGroupChatNotificationEventKey(input);

  assertEquals(first, second);
  assertEquals(isGroupChatNotificationEventKey(first), true);
  assertEquals(
    groupChatNotificationDeliveryKey(first, recipientActorId),
    `${first}:${recipientActorId}`,
  );
});

Deno.test('group-chat notification retry event binds room, message, sender, and committed time', async () => {
  const baseline = await deriveGroupChatNotificationEventKey(input);
  for (const changed of [
    { ...input, roomId: '018f2fc0-9b3d-7c48-8973-88bb28d03a25' },
    { ...input, messageId: '018f2fc0-9b3d-7c48-8973-88bb28d03a26' },
    { ...input, senderActorId: 'admin:01012345678' },
    { ...input, createdAt: '2026-07-25T04:01:00.000Z' },
  ]) {
    assertEquals(
      await deriveGroupChatNotificationEventKey(changed) === baseline,
      false,
    );
  }
});

Deno.test('group-chat notification retry rejects malformed event and recipient input', async () => {
  await assertRejects(
    () => deriveGroupChatNotificationEventKey({ ...input, messageId: 'foreign' }),
    Error,
    'invalid_group_chat_notification_event',
  );
  assertEquals(isGroupChatNotificationEventKey('group-chat-message:forged'), false);
  await assertRejects(
    async () =>
      groupChatNotificationDeliveryKey(
        await deriveGroupChatNotificationEventKey(input),
        'caller-controlled-recipient',
      ),
    Error,
    'invalid_group_chat_notification_delivery_key',
  );
});

Deno.test('group-chat retry token is authenticated and supports one previous signing secret', async () => {
  const eventKey = await deriveGroupChatNotificationEventKey(input);
  const currentToken = await issueGroupChatNotificationRetryToken(
    eventKey,
    currentSecret,
  );
  const previousToken = await issueGroupChatNotificationRetryToken(
    eventKey,
    previousSecret,
  );

  assertEquals(isGroupChatNotificationRetryToken(currentToken), true);
  assertEquals(
    await verifyGroupChatNotificationRetryToken({
      eventKey,
      retryToken: currentToken,
      secrets: [currentSecret, previousSecret],
    }),
    true,
  );
  assertEquals(
    await verifyGroupChatNotificationRetryToken({
      eventKey,
      retryToken: previousToken,
      secrets: [currentSecret, previousSecret],
    }),
    true,
  );
  assertEquals(
    await verifyGroupChatNotificationRetryToken({
      eventKey,
      retryToken: `${currentToken.slice(0, -1)}${
        currentToken.endsWith('0') ? '1' : '0'
      }`,
      secrets: [currentSecret, previousSecret],
    }),
    false,
  );
  assertEquals(
    await verifyGroupChatNotificationRetryToken({
      eventKey,
      retryToken: currentToken,
      secrets: ['wrong-group-chat-retry-secret-0001'],
    }),
    false,
  );
});
