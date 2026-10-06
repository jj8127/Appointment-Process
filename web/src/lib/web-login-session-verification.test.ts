import assert from 'node:assert/strict';
import test from 'node:test';
import {
  verifyWebLoginSessionAtIssuer,
  WEB_LOGIN_SESSION_VERIFICATION_TIMEOUT_MS,
} from './web-login-session-verification.ts';

const now = 1_800_000_000;
const basePayload = {
  kind: 'fc_onboarding_session',
  phone: '01000000001',
  role: 'admin',
  accountKind: 'admin',
  accountId: '10000000-0000-4000-8000-000000000001',
  sessionVersion: 2,
  iat: now - 5,
  exp: now + 3_600,
};
const config = {
  supabaseUrl: 'https://synthetic-project.supabase.co/',
  expectedSupabaseUrl: 'https://synthetic-project.supabase.co',
  serviceRoleKey: 'synthetic-service-key',
  nowSeconds: () => now,
};
const resultFrom = (body: unknown, status = 200) => verifyWebLoginSessionAtIssuer('synthetic-app-token', {
  ...config,
  fetchImpl: async () => Response.json(body, { status }),
});

test('issuer verification transports server credentials and app token only in headers', async () => {
  let calls = 0;
  const result = await verifyWebLoginSessionAtIssuer('  synthetic-app-token  ', {
    ...config,
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, 'https://synthetic-project.supabase.co/functions/v1/verify-app-session');
      assert.equal(init?.method, 'POST');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('apikey'), config.serviceRoleKey);
      assert.equal(headers.get('authorization'), `Bearer ${config.serviceRoleKey}`);
      assert.equal(headers.get('x-app-session-token'), 'synthetic-app-token');
      assert.equal(init?.body, '{}');
      assert.equal(init?.cache, 'no-store');
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal instanceof AbortSignal);
      return Response.json({ ok: true, payload: { ...basePayload, privateExtra: 'must-not-leak' } });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: true, payload: basePayload });
});

for (const role of ['fc', 'admin', 'manager']) {
  test(`issuer verification accepts complete ${role} signed claims`, async () => {
    const payload = { ...basePayload, role, accountKind: role };
    assert.deepEqual(await resultFrom({ ok: true, payload }), { ok: true, payload });
  });
}

test('issuer verification normalizes formatted phones and permits bounded clock skew', async () => {
  const payload = { ...basePayload, phone: '010-0000-0001', iat: now + 60 };
  assert.deepEqual(await resultFrom({ ok: true, payload }), {
    ok: true,
    payload: { ...payload, phone: basePayload.phone },
  });
});

for (const code of ['invalid_app_session', 'expired_app_session']) {
  test(`${code} remains a rejected 401 session without leaking the issuer message`, async () => {
    const result = await resultFrom({ ok: false, code, message: 'synthetic-private-diagnostic' }, 401);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 401);
      assert.equal(result.code, code);
      assert.doesNotMatch(result.message, /synthetic-private/);
    }
  });
}

test('a valid response is rejected when its signed expiry has passed in the web clock', async () => {
  const result = await resultFrom({ ok: true, payload: { ...basePayload, iat: now - 100, exp: now } });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, 'expired_app_session');
    assert.equal(result.status, 401);
  }
});

const malformedPayloads: [string, unknown][] = [
  ['null', null],
  ['array', []],
  ['missing generation', { ...basePayload, accountKind: undefined }],
  ['missing id', { ...basePayload, accountId: undefined }],
  ['bad kind', { ...basePayload, kind: 'request_board_bridge' }],
  ['bad role', { ...basePayload, role: 'designer' }],
  ['different account kind', { ...basePayload, accountKind: 'fc' }],
  ['bad id', { ...basePayload, accountId: 'not-a-uuid' }],
  ['negative generation', { ...basePayload, sessionVersion: -1 }],
  ['fractional generation', { ...basePayload, sessionVersion: 1.5 }],
  ['unsafe generation', { ...basePayload, sessionVersion: Number.MAX_SAFE_INTEGER + 1 }],
  ['string generation', { ...basePayload, sessionVersion: '2' }],
  ['international phone', { ...basePayload, phone: '821000000001' }],
  ['letter in phone', { ...basePayload, phone: '010a00000001' }],
  ['arbitrary phone separators', { ...basePayload, phone: '010.0000.0001' }],
  ['future issue time', { ...basePayload, iat: now + 61 }],
  ['negative issue time', { ...basePayload, iat: -1 }],
  ['fractional issue time', { ...basePayload, iat: now - 0.5 }],
  ['string expiry', { ...basePayload, exp: String(now + 3_600) }],
  ['expiry before issuance', { ...basePayload, exp: basePayload.iat }],
];
for (const [label, payload] of malformedPayloads) {
  test(`malformed issuer claims fail closed: ${label}`, async () => {
    const result = await resultFrom({ ok: true, payload });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 503);
  });
}

const wrongResponses: [string, unknown, number][] = [
  ['null body', null, 200],
  ['array body', [], 200],
  ['wrong success flag', { ok: 'true', payload: basePayload }, 200],
  ['failure with success status', { ok: false, code: 'invalid_app_session' }, 200],
  ['success with denied status', { ok: true, payload: basePayload }, 401],
  ['gateway denial', { message: 'Invalid API key' }, 401],
  ['unknown failure code', { ok: false, code: 'other_failure' }, 401],
  ['service unavailable', { ok: false, code: 'session_verification_unavailable' }, 503],
  ['upstream internal error', { ok: false }, 500],
  ['other success status', { ok: true, payload: basePayload }, 201],
];
for (const [label, body, status] of wrongResponses) {
  test(`incorrect verification response stays unavailable: ${label}`, async () => {
    const result = await resultFrom(body, status);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 503);
  });
}

test('missing configuration or unsafe endpoint never sends privileged headers', async () => {
  const endpointConfigs = [
    { ...config, supabaseUrl: undefined },
    { ...config, serviceRoleKey: '' },
    { ...config, supabaseUrl: 'http://synthetic-project.supabase.co' },
    { ...config, supabaseUrl: 'https://synthetic-project.supabase.co.evil.test' },
    { ...config, supabaseUrl: 'https://user:pass@synthetic-project.supabase.co' },
    { ...config, supabaseUrl: 'https://synthetic-project.supabase.co/path' },
    { ...config, supabaseUrl: 'https://synthetic-project.supabase.co?query=value' },
    { ...config, supabaseUrl: 'https://synthetic-project.supabase.co#fragment' },
    { ...config, supabaseUrl: 'https://synthetic-project.supabase.co:8443' },
    { ...config, expectedSupabaseUrl: 'https://different-project.supabase.co' },
  ];
  for (const endpointConfig of endpointConfigs) {
    const result = await verifyWebLoginSessionAtIssuer('synthetic-app-token', {
      ...endpointConfig,
      fetchImpl: async () => assert.fail('unsafe or missing configuration must not fetch'),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 503);
  }
});

test('empty and excessive tokens fail locally without a request', async () => {
  for (const token of ['', '  ', 'x'.repeat(8_193)]) {
    const result = await verifyWebLoginSessionAtIssuer(token, {
      ...config,
      fetchImpl: async () => assert.fail('invalid token must not fetch'),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 401);
  }
});

test('transport and non-JSON failures return only safe unavailable diagnostics', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('synthetic-private-server-value'); },
    async () => new Response('not-json', { status: 200 }),
  ]) {
    const result = await verifyWebLoginSessionAtIssuer('synthetic-app-token', { ...config, fetchImpl });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 503);
      assert.doesNotMatch(JSON.stringify(result), /synthetic-private|not-json/);
    }
  }
});

test('verification aborts after five seconds and fails unavailable', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  const pending = verifyWebLoginSessionAtIssuer('synthetic-app-token', {
    ...config,
    fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal ?? undefined;
      signal?.addEventListener('abort', () => reject(new Error('synthetic abort')), { once: true });
    }),
  });
  context.mock.timers.tick(WEB_LOGIN_SESSION_VERIFICATION_TIMEOUT_MS - 1);
  assert.equal(signal?.aborted, false);
  context.mock.timers.tick(1);
  assert.equal(signal?.aborted, true);
  const result = await pending;
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 503);
  context.mock.timers.reset();
});
