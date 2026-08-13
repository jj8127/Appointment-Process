/// <reference lib="deno.ns" />

import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  boardNotificationDeliveryKey,
  deriveBoardNotificationEventKey,
  isBoardNotificationEventKey,
} from '../board-notification-event.ts';

const postId = '018f2fc0-9b3d-7c48-8973-88bb28d03a22';
const updatedAt = '2026-07-25T03:00:00.000Z';

Deno.test('board notification event keys are stable for one committed post version', async () => {
  const first = await deriveBoardNotificationEventKey({ postId, updatedAt });
  const second = await deriveBoardNotificationEventKey({ postId, updatedAt });

  assertEquals(first, second);
  assertEquals(isBoardNotificationEventKey(first), true);
  assertEquals(boardNotificationDeliveryKey(first, 'fc'), `${first}:fc`);
  assertEquals(boardNotificationDeliveryKey(first, 'admin'), `${first}:admin`);
});

Deno.test('board notification event keys change with the committed version', async () => {
  const first = await deriveBoardNotificationEventKey({ postId, updatedAt });
  const second = await deriveBoardNotificationEventKey({
    postId,
    updatedAt: '2026-07-25T03:01:00.000Z',
  });
  assertEquals(first === second, false);
});

Deno.test('board notification event keys reject malformed caller input', async () => {
  await assertRejects(
    () => deriveBoardNotificationEventKey({ postId: 'not-a-uuid', updatedAt }),
    Error,
    'invalid_board_notification_event',
  );
  assertEquals(isBoardNotificationEventKey('board-post:forged'), false);
});
