import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as staffSession from './staff-session.ts';
import * as fcSession from './fc-graph-session.ts';
import * as generation from '../../../supabase/functions/_shared/session-generation.ts';
import { verifyWebLoginSessionAtIssuer } from './web-login-session-verification.ts';
import * as loginTimeout from './admin-web-login-timeout.ts';
import * as assistedCookie from './assisted-password-change-cookie.ts';

const require = createRequire(import.meta.url);
const accountId = '10000000-0000-4000-8000-000000000001';
const phone = '01000000001';
const signingSecret = 'synthetic-issuer-only-signing-secret';
const cookieSecret = 'synthetic-web-cookie-secret';
const endpoint = 'https://synthetic-project.supabase.co';
const serviceKey = 'synthetic-server-service-role-key';

function loadModule(file, mocks) {
  const compiled = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(specifier => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    throw new Error(`Unexpected login fixture dependency: ${specifier}`);
  }, loaded, loaded.exports);
  return loaded.exports;
}

async function fixture(options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const role = options.role ?? 'admin';
  const payload = {
    kind: 'fc_onboarding_session',
    phone: options.tokenPhone ?? phone,
    role: options.tokenRole ?? role,
    accountKind: options.tokenRole ?? role,
    accountId,
    sessionVersion: 3,
    iat: now - 5,
    exp: options.expired ? now - 1 : now + 3_600,
  };
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const token = `${payloadPart}.${createHmac('sha256', signingSecret).update(payloadPart).digest('base64url')}`;
  const upstreamData = options.upstreamFailure
    ? { ok: false, message: 'Synthetic invalid credentials' }
    : { ok: true, role, residentId: phone, displayName: 'Synthetic account', appSessionToken: token };
  const cookieClaims = [];
  const diagnostics = [];
  const fetchCalls = [];
  const upstreamCalls = [];
  const savedEnvironment = new Map();
  const environment = {
    SUPABASE_URL: endpoint,
    NEXT_PUBLIC_SUPABASE_URL: endpoint,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    FC_APP_SESSION_TOKEN_SECRET: undefined,
    FC_APP_SESSION_TOKEN_PREVIOUS_SECRET: undefined,
  };
  for (const [name, value] of Object.entries(environment)) {
    savedEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    const webAppSession = loadModule('./request-board-app-session.ts', {
      'node:crypto': require('node:crypto'),
      '../../../supabase/functions/_shared/session-generation.ts': generation,
      './web-login-session-verification.ts': {
        verifyWebLoginSessionAtIssuer: (value, config) => verifyWebLoginSessionAtIssuer(value, {
          ...config,
          fetchImpl: async (url, init) => {
            fetchCalls.push(url);
            assert.equal(url, `${endpoint}/functions/v1/verify-app-session`);
            const headers = new Headers(init.headers);
            assert.equal(headers.get('authorization'), `Bearer ${serviceKey}`);
            assert.equal(headers.get('x-app-session-token'), token);
            if (options.unavailable) return Response.json({ ok: false, code: 'session_verification_unavailable' }, { status: 503 });
            if (options.revoked) return Response.json({ ok: false, code: 'invalid_app_session' }, { status: 401 });
            if (options.expired) return Response.json({ ok: false, code: 'expired_app_session' }, { status: 401 });
            return Response.json({ ok: true, payload });
          },
        }),
      },
    });
    const route = loadModule('../app/api/auth/login/route.ts', {
      'next/server': require('next/server'),
      '@supabase/supabase-js': {
        createClient: () => ({ functions: { invoke: async (name, config) => {
          upstreamCalls.push(name);
          assert.equal(name, 'login-with-password');
          assert.deepEqual(config.body, { phone, password: 'synthetic-password' });
          return { data: upstreamData, error: null };
        } } }),
      },
      '@/lib/request-board-app-session': webAppSession,
      '@/lib/staff-session': {
        ...staffSession,
        createStaffSessionValue: options => {
          cookieClaims.push(options);
          return staffSession.createStaffSessionValue({ ...options, secret: cookieSecret });
        },
      },
      '@/lib/fc-graph-session': {
        ...fcSession,
        createFcGraphSessionValue: options => {
          cookieClaims.push(options);
          return fcSession.createFcGraphSessionValue({ ...options, secret: cookieSecret });
        },
      },
      '@/lib/admin-supabase': {
        adminSupabase: { from: table => {
          assert.equal(table, 'fc_profiles');
          const query = {
            select: () => query,
            in: () => query,
            maybeSingle: async () => ({ data: { id: accountId }, error: null }),
          };
          return query;
        } },
      },
      '@/lib/admin-web-login-timeout': loginTimeout,
      '@/lib/phone-candidates': { buildPhoneCandidates: () => [phone] },
      '@/lib/logger': { logger: {
        warn: (...values) => diagnostics.push(values),
        error: (...values) => diagnostics.push(values),
      } },
      '@/lib/assisted-password-change-cookie': assistedCookie,
    });
    const response = await route.POST(new Request('https://synthetic-admin.example.test/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password: 'synthetic-password' }),
    }));
    return { response, body: await response.json(), token, cookieClaims, diagnostics, fetchCalls, upstreamCalls, role };
  } finally {
    for (const [name, value] of savedEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

for (const role of ['admin', 'manager', 'fc']) {
  test(`${role} login creates generation-bound cookies without web app signing keys`, async () => {
    const result = await fixture({ role });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.appSessionToken, undefined);
    assert.equal(result.body.passwordChangeToken, undefined);
    assert.equal(result.fetchCalls.length, 1);
    assert.deepEqual(result.upstreamCalls, ['login-with-password']);
    assert.equal(result.cookieClaims.length, 1);
    assert.equal(result.cookieClaims[0].accountId, accountId);
    assert.equal(result.cookieClaims[0].accountKind, role);
    assert.equal(result.cookieClaims[0].sessionVersion, 3);
    assert.equal(result.response.cookies.get('web_app_session').value, result.token);
    const cookieName = role === 'fc' ? 'fc_graph_session' : 'staff_session';
    const cookie = result.response.cookies.get(cookieName);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'strict');
    const verified = role === 'fc'
      ? fcSession.verifyFcGraphSessionValue(cookie.value, { secret: cookieSecret, expectedResidentDigits: phone })
      : staffSession.verifyStaffSessionValue(cookie.value, { secret: cookieSecret, expectedRole: role, expectedResidentDigits: phone });
    assert.ok(verified);
    assert.equal(verified.accountId, accountId);
    assert.equal(verified.sessionVersion, 3);
  });
}

test('formatted issuer phone still matches the normalized login response identity', async () => {
  const result = await fixture({ tokenPhone: '010-0000-0001' });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
});

for (const [label, options, status] of [
  ['phone mismatch', { tokenPhone: '01000000002' }, 401],
  ['role mismatch', { tokenRole: 'manager' }, 401],
  ['revoked generation', { revoked: true }, 401],
  ['expired token', { expired: true }, 401],
  ['issuer outage', { unavailable: true }, 503],
]) {
  test(`login refuses to issue cookies for ${label}`, async () => {
    const result = await fixture(options);
    assert.equal(result.response.status, status);
    assert.equal(result.body.ok, false);
    assert.equal(result.response.cookies.get('web_app_session'), undefined);
    assert.equal(result.response.cookies.get('staff_session'), undefined);
    assert.equal(result.response.cookies.get('fc_graph_session'), undefined);
    assert.equal(result.cookieClaims.length, 0);
    assert.equal(result.fetchCalls.length, 1);
    assert.doesNotMatch(JSON.stringify(result.body), new RegExp(`${phone}|${accountId}|${result.token.replaceAll('.', '\\.')}`));
    assert.doesNotMatch(JSON.stringify(result.diagnostics), new RegExp(`${phone}|${accountId}|synthetic-password|${result.token.replaceAll('.', '\\.')}`));
  });
}

test('failed upstream credentials do not invoke verification and clear login cookies', async () => {
  const result = await fixture({ upstreamFailure: true });
  assert.equal(result.body.ok, false);
  assert.equal(result.fetchCalls.length, 0);
  assert.equal(result.cookieClaims.length, 0);
  assert.equal(result.response.cookies.get('web_app_session').value, '');
});
