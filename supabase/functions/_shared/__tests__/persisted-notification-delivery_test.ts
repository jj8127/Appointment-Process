/// <reference lib="deno.ns" />

import {
  assertEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  deliverAfterPersistedNotification,
  validatePersistedNotificationForDelivery,
} from '../persisted-notification-delivery.ts';

const notificationId = '018f2fc0-6ee7-7b5f-8e49-2e754de66b5d';
const fcId = '018f2fc0-9b3d-7c48-8973-88bb28d03a22';
const target = { version: 1, kind: 'fc_profile', fcId } as const;
const expected = {
  target,
  recipientRole: 'fc' as const,
  recipientActorId: fcId,
  residentId: '01000000000',
};

Deno.test('provider is not called when notification insert fails', async () => {
  let providerCalls = 0;
  const result = await deliverAfterPersistedNotification({
    persist: async () => ({ error: new Error('db unavailable') }),
    expected,
    deliver: async () => {
      providerCalls += 1;
      return { sent: 1 };
    },
  });

  assertEquals(result, {
    confirmed: false,
    reason: 'notification_insert_failed',
  });
  assertEquals(providerCalls, 0);
});

Deno.test('provider is not called when insert returns no canonical UUID', async () => {
  let providerCalls = 0;
  const result = await deliverAfterPersistedNotification({
    persist: async () => ({
      row: {
        id: null,
        target,
        recipient_role: 'fc',
        recipient_actor_id: fcId,
        resident_id: '01000000000',
      },
    }),
    expected,
    deliver: async () => {
      providerCalls += 1;
      return { sent: 1 };
    },
  });

  assertEquals(result, {
    confirmed: false,
    reason: 'missing_notification_id',
  });
  assertEquals(providerCalls, 0);
});

Deno.test('provider is not called when the persisted typed target differs', async () => {
  let providerCalls = 0;
  const result = await deliverAfterPersistedNotification({
    persist: async () => ({
      row: {
        id: notificationId,
        target: {
          version: 1,
          kind: 'onboarding_section',
          fcId,
          section: 'home',
        },
        recipient_role: 'fc',
        recipient_actor_id: fcId,
        resident_id: '01000000000',
      },
    }),
    expected,
    deliver: async () => {
      providerCalls += 1;
      return { sent: 1 };
    },
  });

  assertEquals(result, {
    confirmed: false,
    reason: 'target_mismatch',
  });
  assertEquals(providerCalls, 0);
});

Deno.test('provider is not called when the persisted recipient differs', async () => {
  let providerCalls = 0;
  const result = await deliverAfterPersistedNotification({
    persist: async () => ({
      row: {
        id: notificationId,
        target,
        recipient_role: 'fc',
        recipient_actor_id: '018f2fc0-5cfb-7ca9-89c9-feb0966e2e31',
        resident_id: '01000000000',
      },
    }),
    expected,
    deliver: async () => {
      providerCalls += 1;
      return { sent: 1 };
    },
  });

  assertEquals(result, {
    confirmed: false,
    reason: 'recipient_mismatch',
  });
  assertEquals(providerCalls, 0);
});

Deno.test('normal delivery preserves exact persisted notification UUID parity', async () => {
  let deliveredNotificationId: string | null = null;
  const result = await deliverAfterPersistedNotification({
    persist: async () => ({
      row: {
        id: notificationId,
        target,
        recipient_role: 'fc',
        recipient_actor_id: fcId,
        resident_id: '01000000000',
      },
    }),
    expected,
    deliver: async (notification) => {
      deliveredNotificationId = notification.notificationId;
      return { sent: 1 };
    },
  });

  assertEquals(result.confirmed, true);
  assertEquals(deliveredNotificationId, notificationId);
  assertEquals(
    validatePersistedNotificationForDelivery(
      {
        id: notificationId,
        target,
        recipient_role: 'fc',
        recipient_actor_id: fcId,
        resident_id: '01000000000',
      },
      expected,
    ),
    {
      ok: true,
      notificationId,
      target,
    },
  );
});
