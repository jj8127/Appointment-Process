import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  beginSmsDeliveryAttempt,
  finalizeFcSignupDeliveryAttempt,
  finalizeSmsDeliveryAttempt,
} from '../sms-delivery-attempt.ts';

const DELIVERY_ID = '10000000-0000-4000-8000-000000000001';

test('delivery adapter accepts only a UUID begin result and sends provider metadata to finalization', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return name === 'begin_platform_sms_delivery_attempt'
        ? { data: { ok: true, deliveryId: DELIVERY_ID }, error: null }
        : { data: { ok: true }, error: null };
    },
  };

  assert.deepEqual(await beginSmsDeliveryAttempt(client as never, 'fc_signup'), {
    ok: true,
    deliveryId: DELIVERY_ID,
  });
  assert.equal(await finalizeSmsDeliveryAttempt(client as never, 'fc_signup', DELIVERY_ID, {
    ok: true,
    deliveryState: 'accepted',
    status: 200,
    providerRequestId: 'synthetic-request-1',
    providerStatusCode: '202',
  }), true);
  assert.deepEqual(calls, [
    {
      name: 'begin_platform_sms_delivery_attempt',
      args: { p_purpose: 'fc_signup' },
    },
    {
      name: 'finalize_platform_sms_delivery_attempt',
      args: {
        p_delivery_id: DELIVERY_ID,
        p_purpose: 'fc_signup',
        p_state: 'accepted',
        p_provider_request_id: 'synthetic-request-1',
        p_provider_status_code: '202',
        p_failure_reason: null,
      },
    },
  ]);
});

test('FC signup finalization binds provider state to phone and delivery ownership', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: { ok: true, current: true }, error: null };
    },
  };

  assert.equal(await finalizeFcSignupDeliveryAttempt(
    client as never,
    '01000000001',
    DELIVERY_ID,
    {
      ok: false,
      deliveryState: 'rejected',
      status: 503,
      reason: 'provider_rejected',
      providerRequestId: null,
      providerStatusCode: '400',
      message: 'safe',
    },
  ), true);
  assert.deepEqual(calls, [{
    name: 'finalize_fc_signup_otp_delivery_v1',
    args: {
      p_phone: '01000000001',
      p_delivery_id: DELIVERY_ID,
      p_state: 'rejected',
      p_provider_request_id: null,
      p_provider_status_code: '400',
      p_failure_reason: 'provider_rejected',
    },
  }]);
});

test('delivery adapter fails closed on malformed or failed database responses', async () => {
  for (const response of [
    { data: { ok: true, deliveryId: 'not-a-uuid' }, error: null },
    { data: { ok: false }, error: null },
    { data: null, error: { message: 'private database detail' } },
  ]) {
    const client = { rpc: async () => response };
    assert.deepEqual(await beginSmsDeliveryAttempt(client as never, 'password_reset'), { ok: false });
  }

  const throwing = { rpc: async () => { throw new Error('private database detail'); } };
  assert.deepEqual(await beginSmsDeliveryAttempt(throwing as never, 'password_reset'), { ok: false });
  assert.equal(await finalizeSmsDeliveryAttempt(throwing as never, 'password_reset', DELIVERY_ID, {
    ok: false,
    deliveryState: 'unknown',
    status: 503,
    reason: 'timeout',
    providerRequestId: null,
    providerStatusCode: null,
    message: 'safe',
  }), false);
  assert.equal(await finalizeFcSignupDeliveryAttempt(throwing as never, '01000000001', DELIVERY_ID, {
    ok: false,
    deliveryState: 'unknown',
    status: 503,
    reason: 'timeout',
    providerRequestId: null,
    providerStatusCode: null,
    message: 'safe',
  }), false);
});
