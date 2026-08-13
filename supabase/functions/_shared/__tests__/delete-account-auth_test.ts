import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authorizeDeleteAccountRequest,
} from '../delete-account-auth.ts';

const fcId = '11111111-1111-4111-8111-111111111111';
const foreignFcId = '22222222-2222-4222-8222-222222222222';
const serviceRoleKey = 'service-role-key';
const internalSecret = 'dedicated-delete-secret';

test('authorizes only the exact FC self identity', () => {
  assert.deepEqual(
    authorizeDeleteAccountRequest({
      body: { role: 'fc', residentId: '01012345678' },
      authorizationHeader: 'Bearer anon-key',
      internalSecretHeader: '',
      serviceRoleKey,
      internalSecret,
      session: { role: 'fc', phone: '010-1234-5678', fcId },
    }),
    {
      ok: true,
      mode: 'fc_self',
      targetRole: 'fc',
      targetId: fcId,
    },
  );
});

test('rejects foreign body selectors and non-FC sessions', () => {
  assert.deepEqual(
    authorizeDeleteAccountRequest({
      body: { role: 'fc', residentId: '01099999999', fcId: foreignFcId },
      authorizationHeader: 'Bearer anon-key',
      internalSecretHeader: '',
      serviceRoleKey,
      internalSecret,
      session: { role: 'fc', phone: '01012345678', fcId },
    }),
    {
      ok: false,
      status: 403,
      code: 'self_delete_target_mismatch',
    },
  );
  assert.deepEqual(
    authorizeDeleteAccountRequest({
      body: { role: 'fc', residentId: '01012345678' },
      authorizationHeader: 'Bearer anon-key',
      internalSecretHeader: '',
      serviceRoleKey,
      internalSecret,
      session: { role: 'manager', phone: '01012345678' },
    }),
    {
      ok: false,
      status: 403,
      code: 'self_delete_role_forbidden',
    },
  );
});

test('requires exact service authorization and the dedicated internal secret', () => {
  const body = { role: 'admin' as const, targetId: foreignFcId };
  assert.equal(
    authorizeDeleteAccountRequest({
      body,
      authorizationHeader: `Bearer ${serviceRoleKey}`,
      internalSecretHeader: 'wrong',
      serviceRoleKey,
      internalSecret,
      session: null,
    }).ok,
    false,
  );
  assert.deepEqual(
    authorizeDeleteAccountRequest({
      body,
      authorizationHeader: `Bearer ${serviceRoleKey}`,
      internalSecretHeader: internalSecret,
      serviceRoleKey,
      internalSecret,
      session: null,
    }),
    {
      ok: true,
      mode: 'internal',
      targetRole: 'admin',
      targetId: foreignFcId,
    },
  );
});

test('rejects arbitrary, empty, and non-string internal runtime roles', () => {
  for (const role of [undefined, '', 'superadmin', 42, false, {}, []]) {
    assert.deepEqual(
      authorizeDeleteAccountRequest({
        body: {
          role: role as never,
          targetId: foreignFcId,
        },
        authorizationHeader: `Bearer ${serviceRoleKey}`,
        internalSecretHeader: internalSecret,
        serviceRoleKey,
        internalSecret,
        session: null,
      }),
      {
        ok: false,
        status: 403,
        code: 'invalid_internal_authorization',
      },
    );
  }
});
