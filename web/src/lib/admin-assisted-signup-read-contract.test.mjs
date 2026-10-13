import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function loadAssistedSignupContract() {
  const source = readFileSync(new URL('./admin-assisted-signup-validation.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: (id) => {
      if (id === 'zod') return require('zod');
      if (id === './signup-profile-options') {
        return {
          SIGNUP_AFFILIATION_OPTIONS: ['한화생명금융서비스'],
          SIGNUP_CARRIER_OPTIONS: ['SKT'],
        };
      }
      throw new Error(`Unexpected validation dependency ${id}`);
    },
  });
  return exports;
}

const assistedSignupContract = loadAssistedSignupContract();
const {
  parseAdminAssistedSignupSuccess,
  parseSignupReferralSearchResults,
  readSignupReferralSearchResponse,
} = assistedSignupContract;

function fixture(upstreamData) {
  const loggerCalls = [];
  const source = readFileSync(new URL('../app/api/admin/assisted-signup/route.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};

  vm.runInNewContext(code, { exports, URL, require: (id) => {
    if (id === 'next/server') {
      return { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } };
    }
    if (id === '@/lib/admin-assisted-signup-contract') {
      return {
        adminAssistedSignupSchema: { safeParse: () => ({ success: false }) },
        firstAdminAssistedSignupError: () => 'invalid',
        parseAdminAssistedSignupSuccess,
        parseSignupReferralSearchResults,
      };
    }
    if (id === '@/lib/admin-assisted-signup-server') return { createAdminAssistedSignup: async () => ({}) };
    if (id === '@/lib/admin-route-auth') {
      return {
        adminRouteAuthErrorResponse: () => ({ status: 401 }),
        requireAdminRoute: async () => ({
          ok: true,
          session: { residentDigits: '01000000000', role: 'admin', staffType: 'admin' },
        }),
      };
    }
    if (id === '@/lib/admin-supabase') {
      return { adminSupabase: { functions: { invoke: async () => ({ data: upstreamData, error: null }) } } };
    }
    if (id === '@/lib/csrf') return { checkRateLimit: () => ({ allowed: true }), verifyOrigin: async () => ({ valid: true }) };
    if (id === '@/lib/logger') return { logger: { warn: (...args) => loggerCalls.push(args) } };
    throw new Error(`Unexpected dependency ${id}`);
  } });

  return { GET: exports.GET, loggerCalls };
}

test('shared referral result parser validates and normalizes every row', () => {
  assert.equal(parseSignupReferralSearchResults([{ fcId: 'fc-1' }]), null);
  assert.equal(parseSignupReferralSearchResults({}), null);
  assert.equal(
    JSON.stringify(parseSignupReferralSearchResults([
      { fcId: ' fc-1 ', name: ' 테스트 ', affiliation: ' 지점 ', code: ' CODE ' },
    ])),
    JSON.stringify([{ fcId: 'fc-1', name: '테스트', affiliation: '지점', code: 'CODE' }]),
  );
});

test('referral response reader rejects null and non-JSON 2xx payloads with a stable message', async () => {
  for (const response of [
    new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    new Response('<html>upstream error</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
  ]) {
    await assert.rejects(
      readSignupReferralSearchResponse(response),
      (error) => error?.name === 'SignupReferralSearchError'
        && error.message === '추천인 검색에 실패했습니다.',
    );
  }
});

test('referral response reader accepts the canonical success contract', async () => {
  const results = await readSignupReferralSearchResponse(Response.json({
    ok: true,
    results: [{ fcId: ' fc-1 ', name: ' 테스트 ', affiliation: ' 지점 ', code: ' CODE ' }],
  }));
  assert.equal(JSON.stringify(results), JSON.stringify([
    { fcId: 'fc-1', name: '테스트', affiliation: '지점', code: 'CODE' },
  ]));
});

test('shared assisted-signup success parser rejects incomplete acknowledgements', () => {
  assert.equal(parseAdminAssistedSignupSuccess({ ok: true }), null);
  assert.equal(parseAdminAssistedSignupSuccess({
    ok: true,
    fcId: 'fc-1',
    verificationMethod: 'admin_written_consent',
    requiresPasswordChange: true,
  }), null);
  assert.equal(JSON.stringify(parseAdminAssistedSignupSuccess({
    ok: true,
    fcId: ' fc-1 ',
    verificationMethod: 'admin_written_consent',
    requiresPasswordChange: true,
    alreadyApplied: false,
  })), JSON.stringify({
    ok: true,
    fcId: 'fc-1',
    verificationMethod: 'admin_written_consent',
    requiresPasswordChange: true,
    alreadyApplied: false,
  }));
});

test('assisted-signup referral search rejects a 200 acknowledgement without results', async () => {
  const h = fixture({ ok: true });
  const response = await h.GET(new Request('https://admin.example/api/admin/assisted-signup?q=test'));

  assert.equal(response.status, 502);
  assert.equal(JSON.stringify(response.body), JSON.stringify({ ok: false, message: '추천인 검색을 지금 사용할 수 없습니다.' }));
  assert.equal(h.loggerCalls.length, 1);
});

test('assisted-signup referral search preserves a valid empty result list', async () => {
  const h = fixture({ ok: true, results: [] });
  const response = await h.GET(new Request('https://admin.example/api/admin/assisted-signup?q=test'));

  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(response.body), JSON.stringify({ ok: true, results: [] }));
});

test('assisted-signup referral search rejects malformed result rows', async () => {
  const response = await fixture({ ok: true, results: [{ fcId: 'fc-1' }] })
    .GET(new Request('https://admin.example/api/admin/assisted-signup?q=test'));

  assert.equal(response.status, 502);
  assert.equal(JSON.stringify(response.body), JSON.stringify({ ok: false, message: '추천인 검색을 지금 사용할 수 없습니다.' }));
});

test('assisted-signup page also validates results before rendering the empty state', () => {
  const source = readFileSync(new URL('../app/dashboard/fc-signup/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /readSignupReferralSearchResponse\(response\)/);
  assert.match(source, /parseAdminAssistedSignupSuccess\(payload\)/);
  assert.doesNotMatch(source, /data\.results(?: \?\? \[\]|\.filter)/);
});
