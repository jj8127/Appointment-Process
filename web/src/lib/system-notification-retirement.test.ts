import assert from 'node:assert/strict';
import test from 'node:test';

import { retireSystemNotificationsWith } from './system-notification-retirement.ts';

test('retires the server registration, local push subscription, and displayed notifications', async () => {
  let deleteCalls = 0;
  let unsubscribeCalls = 0;
  let closeCalls = 0;

  await retireSystemNotificationsWith({
    deleteServerRegistration: async () => {
      deleteCalls += 1;
    },
    getRegistrations: async () => [{
      pushManager: {
        getSubscription: async () => ({
          unsubscribe: async () => {
            unsubscribeCalls += 1;
            return true;
          },
        }),
      },
      getNotifications: async () => [
        { close: () => { closeCalls += 1; } },
        { close: () => { closeCalls += 1; } },
      ],
    }],
  });

  assert.equal(deleteCalls, 1);
  assert.equal(unsubscribeCalls, 1);
  assert.equal(closeCalls, 2);
});

test('continues local cleanup when actor-scoped server retirement is unavailable', async () => {
  let unsubscribeCalls = 0;
  let closeCalls = 0;

  await retireSystemNotificationsWith({
    deleteServerRegistration: async () => {
      throw new Error('unavailable');
    },
    getRegistrations: async () => [{
      pushManager: {
        getSubscription: async () => ({
          unsubscribe: async () => {
            unsubscribeCalls += 1;
            return true;
          },
        }),
      },
      getNotifications: async () => [{ close: () => { closeCalls += 1; } }],
    }],
  });

  assert.equal(unsubscribeCalls, 1);
  assert.equal(closeCalls, 1);
});
