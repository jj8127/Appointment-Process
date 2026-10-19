import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const DELIVERY_ID = '30000000-0000-4000-8000-000000000001';
const AUTH_PROFILE_ID = '30000000-0000-4000-8000-000000000002';
const PHONE = '01012345678';

async function loadTs(relativePath, dependencies, globals = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const exports = {};
  const names = Object.keys(globals);
  new Function('require', 'exports', ...names, code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected test dependency: ${name}`);
  }, exports, ...names.map(name => globals[name]));
  return exports;
}

async function fixture() {
  let serveHandler;
  let issueResponse = {
    data: { ok: true, deliveryId: DELIVERY_ID, authProfileIds: [], resetApplied: false },
    error: null,
  };
  let smsResult = {
    ok: true,
    deliveryState: 'accepted',
    status: 200,
    providerRequestId: 'synthetic-request',
    providerStatusCode: '202',
  };
  let finalizeResult = true;
  let authDeleteError = null;
  const events = [];

  const supabase = {
    from(table) {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          events.push({ phase: 'lookup', table });
          return { data: null, error: null };
        },
      };
    },
    rpc: async (name, args) => {
      assert.equal(name, 'issue_fc_signup_otp_v1');
      events.push({ phase: 'issue', args });
      return issueResponse;
    },
    auth: {
      admin: {
        deleteUser: async id => {
          events.push({ phase: 'auth_cleanup', id });
          return { error: authDeleteError };
        },
      },
    },
  };
  const env = {
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
    TEST_SMS_MODE: 'true',
    TEST_SMS_CODE: '123456',
    NODE_ENV: 'test',
  };
  await loadTs('../request-signup-otp/index.ts', {
    '../_shared/serve-with-cors.ts': {
      serveWithConfiguredCors: callback => { serveHandler = callback; },
    },
    'https://esm.sh/@supabase/supabase-js@2.45.4': {
      createClient: () => supabase,
    },
    '../_shared/signup-sms.ts': {
      sendSignupSms: async (to, code, content, simulated) => {
        events.push({ phase: 'sms', to, code, content, simulated });
        return smsResult;
      },
    },
    '../_shared/sms-delivery-attempt.ts': {
      finalizeFcSignupDeliveryAttempt: async (_client, phone, deliveryId, result) => {
        events.push({ phase: 'finalize', phone, deliveryId, result });
        return finalizeResult;
      },
    },
    '../_shared/signup-client-observation.ts': {
      reportSignupClientObservation: () => {},
      SIGNUP_CLIENT_HEADERS: { version: 'x-signup-client-version' },
    },
  }, {
    globalThis: { Deno: { env: { get: key => env[key] } } },
    crypto: webcrypto,
    console: { info() {}, warn() {}, error() {} },
  });

  return {
    events,
    setIssueResponse(value) { issueResponse = value; },
    setSmsResult(value) { smsResult = value; },
    setFinalizeResult(value) { finalizeResult = value; },
    setAuthDeleteError(value) { authDeleteError = value; },
    async request(body = { phone: PHONE }) {
      const response = await serveHandler(new Request('http://localhost/fixture', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
      }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('FC signup availability check returns the deployed minimal receipt without issuing an OTP', async () => {
  const f = await fixture();
  const result = await f.request({ phone: PHONE, checkOnly: true });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, available: true });
  assert.equal(f.events.some(event => event.phase === 'issue'), false);
  assert.equal(f.events.some(event => event.phase === 'sms'), false);
  assert.equal(f.events.some(event => event.phase === 'finalize'), false);
});

test('FC signup handler never sends before a valid atomic issue result', async () => {
  for (const issueResponse of [
    { data: null, error: { message: 'synthetic private diagnostic' } },
    { data: { ok: true, deliveryId: 'malformed', authProfileIds: [] }, error: null },
    { data: { ok: true, deliveryId: DELIVERY_ID, authProfileIds: ['malformed'] }, error: null },
    { data: { ok: false, code: 'cooldown' }, error: null },
  ]) {
    const f = await fixture();
    f.setIssueResponse(issueResponse);
    const result = await f.request();
    assert.equal(result.body.ok, false);
    assert.equal(f.events.filter(event => event.phase === 'sms').length, 0);
    assert.equal(f.events.filter(event => event.phase === 'finalize').length, 0);
  }
});

test('FC signup handler finalizes definite rejection and never reports it as success', async () => {
  const f = await fixture();
  f.setIssueResponse({
    data: { ok: true, deliveryId: DELIVERY_ID, authProfileIds: [AUTH_PROFILE_ID], resetApplied: true },
    error: null,
  });
  f.setAuthDeleteError({ status: 503, message: 'synthetic private diagnostic' });
  const rejection = {
    ok: false,
    deliveryState: 'rejected',
    status: 502,
    reason: 'provider_rejected',
    providerRequestId: null,
    providerStatusCode: '400',
    message: 'safe',
  };
  f.setSmsResult(rejection);
  const result = await f.request();
  assert.equal(result.status, 502);
  assert.equal(result.body.code, 'sms_send_failed');
  assert.deepEqual(f.events.map(event => event.phase), [
    'lookup', 'lookup', 'lookup', 'issue', 'auth_cleanup', 'sms', 'finalize',
  ]);
  assert.deepEqual(f.events.at(-1), {
    phase: 'finalize',
    phone: PHONE,
    deliveryId: DELIVERY_ID,
    result: rejection,
  });
});

test('FC signup handler preserves uncertain outcomes and requires durable finalization for success', async () => {
  const unknown = {
    ok: false,
    deliveryState: 'unknown',
    status: 503,
    reason: 'timeout',
    providerRequestId: null,
    providerStatusCode: null,
    message: 'safe',
  };
  const uncertain = await fixture();
  uncertain.setSmsResult(unknown);
  const unknownResult = await uncertain.request();
  assert.equal(unknownResult.status, 503);
  assert.equal(unknownResult.body.code, 'sms_delivery_unknown');
  assert.equal(uncertain.events.at(-1).phase, 'finalize');

  const lostFinalize = await fixture();
  lostFinalize.setFinalizeResult(false);
  const lostResult = await lostFinalize.request();
  assert.equal(lostResult.status, 503);
  assert.equal(lostResult.body.code, 'sms_delivery_unknown');
  assert.equal(lostFinalize.events.filter(event => event.phase === 'sms').length, 1);
  assert.equal(lostFinalize.events.filter(event => event.phase === 'finalize').length, 1);

  const accepted = await fixture();
  const acceptedResult = await accepted.request();
  assert.equal(acceptedResult.status, 200);
  assert.deepEqual(acceptedResult.body, { ok: true, sent: true, test_mode: true });
});
