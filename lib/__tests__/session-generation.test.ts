import { createHmac } from 'node:crypto';
import {
  checkSessionGeneration,
  parseSessionGenerationClaims,
  verifySessionGeneration,
  type SessionGenerationClaims,
  type SessionGenerationLookup,
} from '../../supabase/functions/_shared/session-generation';
import {
  createAppSessionToken,
  createRequestBoardBridgeToken,
  parseAppSessionTokenDetailed,
  parseRequestBoardBridgeTokenDetailed,
  requireAppSessionFromRequest,
} from '../../supabase/functions/_shared/request-board-auth';
import { createRequestBoardSessionVerificationHandler } from '../../supabase/functions/_shared/request-board-session-verification';
import { createStaffSessionValue, verifyStaffSessionValue } from '../../web/src/lib/staff-session';
import { createFcGraphSessionValue, verifyFcGraphSessionValue } from '../../web/src/lib/fc-graph-session';
import { createWebGroupChatAppSessionToken } from '../../web/src/lib/request-board-app-session';

const id = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const phone = '00000000001';
const secret = 'synthetic-session-generation-secret-32-bytes';
const state = (version = 0, accountKind: SessionGenerationClaims['accountKind'] = 'fc'): SessionGenerationClaims => ({
  accountId: id, accountKind, sessionVersion: version,
});
const lookup = (version: number): SessionGenerationLookup => async (input) =>
  checkSessionGeneration(input, { ...state(version, input.accountKind ?? 'fc'), createdAt: '2000-01-01T00:00:00Z' });
const sign = (payload: object) => {
  const part = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${part}.${createHmac('sha256', secret).update(part).digest('base64url')}`;
};
const envKeys = ['FC_APP_SESSION_TOKEN_SECRET', 'REQUEST_BOARD_BRIDGE_TOKEN_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
beforeEach(() => {
  process.env.FC_APP_SESSION_TOKEN_SECRET = secret;
  process.env.REQUEST_BOARD_BRIDGE_TOKEN_SECRET = secret;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});
afterEach(() => { jest.restoreAllMocks(); });
afterAll(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('per-account credential generations', () => {
  it('accepts legacy accounts at zero and rejects only the account whose password changed', async () => {
    const legacy = sign({ kind: 'fc_onboarding_session', phone, role: 'fc', fcId: id,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 });
    expect((await parseAppSessionTokenDetailed(legacy!, lookup(0))).ok).toBe(true);
    expect(await parseAppSessionTokenDetailed(legacy!, lookup(1))).toMatchObject({ ok: false, code: 'invalid_app_session', status: 401 });
    expect((await parseAppSessionTokenDetailed(legacy!, lookup(0))).ok).toBe(true);
  });

  it.each([
    { sessionVersion: 0 }, { ...state(), sessionVersion: -1 }, { ...state(), sessionVersion: 1.5 },
    { ...state(), sessionVersion: Number.NaN }, { ...state(), accountKind: 'designer' },
    { ...state(), accountId: 'not-a-uuid' }, { ...state(), sessionVersion: '0' },
  ])('rejects partial or invalid generation claims %#', invalid => {
    expect(parseSessionGenerationClaims(invalid as SessionGenerationClaims)).toBeNull();
  });

  it('does not accept another account or upgrade a stale login to the current generation', async () => {
    const token = await createAppSessionToken(phone, 'fc', undefined, id, state(2));
    expect((await parseAppSessionTokenDetailed(token!, lookup(3))).ok).toBe(false);
    expect(checkSessionGeneration({ phone, role: 'fc', ...state(2) }, { ...state(2), accountId: otherId }).ok).toBe(false);
    expect(checkSessionGeneration({ phone, role: 'fc', fcId: otherId, ...state(2) }, state(2)).ok).toBe(false);
    expect((await parseAppSessionTokenDetailed(token!, lookup(2))).ok).toBe(true);
  });

  it('rejects legacy phone-only sessions when the number belongs to a later or same-second recreated account', () => {
    const iat = 1_800_000_000;
    const input = { phone, role: 'admin', iat };
    expect(checkSessionGeneration(input, { ...state(0, 'admin'), createdAt: new Date((iat - 1) * 1000).toISOString() }).ok).toBe(true);
    expect(checkSessionGeneration(input, { ...state(0, 'admin'), createdAt: new Date(iat * 1000).toISOString() }).ok).toBe(false);
    expect(checkSessionGeneration(input, { ...state(0, 'admin'), createdAt: new Date(iat * 1000 + 1).toISOString() }).ok).toBe(false);
    expect(checkSessionGeneration(input, { ...state(0, 'admin'), createdAt: new Date((iat + 1) * 1000).toISOString() }).ok).toBe(false);
    expect(checkSessionGeneration({ ...input, iat: undefined }, { ...state(0, 'admin'), createdAt: '2000-01-01T00:00:00Z' }).ok).toBe(false);
  });

  it('blocks both bridge-to-app and app-to-bridge renewal after a password change', async () => {
    const bridge = await createRequestBoardBridgeToken(phone, 'fc', null, state(4));
    const parsedBridge = await parseRequestBoardBridgeTokenDetailed(bridge!, lookup(4));
    expect(parsedBridge.ok).toBe(true);
    if (!parsedBridge.ok) throw new Error('fixture invalid');
    // A reset may commit after verification but before issuance. Carrying the
    // verified generation, rather than re-reading a newer one, stays revoked.
    const app = await createAppSessionToken(phone, 'fc', undefined, id, parsedBridge.payload);
    expect((await parseAppSessionTokenDetailed(app!, lookup(5))).ok).toBe(false);
    expect((await parseRequestBoardBridgeTokenDetailed(bridge!, lookup(5))).ok).toBe(false);
    const parsedApp = await parseAppSessionTokenDetailed(app!, lookup(4));
    if (!parsedApp.ok) throw new Error('fixture invalid');
    const renewed = await createRequestBoardBridgeToken(phone, 'fc', null, parsedApp.payload);
    expect((await parseRequestBoardBridgeTokenDetailed(renewed!, lookup(5))).ok).toBe(false);
  });

  it.each(['manager', 'admin'] as const)('keeps canonical %s identity separate from the bridge display role', async (kind) => {
    const role = kind === 'admin' ? 'fc' : 'manager';
    const bridge = await createRequestBoardBridgeToken(phone, role, null, state(1, kind));
    const result = await parseRequestBoardBridgeTokenDetailed(bridge!, lookup(1));
    expect(result).toMatchObject({ ok: true, payload: { role, accountKind: kind, accountId: id, sessionVersion: 1 } });
  });

  it('uses the real default DB guard and returns 503 for an unavailable guard', async () => {
    const token = await createAppSessionToken(phone, 'fc', undefined, id, state());
    const request = new Request('https://local.invalid', { headers: { 'x-app-session-token': token! } });
    expect(await requireAppSessionFromRequest(request)).toMatchObject({ ok: false, status: 503, code: 'session_verification_unavailable' });
    process.env.SUPABASE_URL = 'https://local.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-key';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(state(1))));
    expect(await requireAppSessionFromRequest(request)).toMatchObject({ ok: false, status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(new Response(JSON.stringify(state())));
    expect(await requireAppSessionFromRequest(request)).toMatchObject({ ok: true, session: state() });
    expect(fetchMock).toHaveBeenCalledTimes(2); // no positive freshness cache
  });

  it('rejects an invalid signature before consulting account state', async () => {
    const read = jest.fn(lookup(0));
    const token = sign({ kind: 'fc_onboarding_session', phone, role: 'fc', exp: Math.floor(Date.now() / 1000) + 60 });
    expect((await parseAppSessionTokenDetailed(`${token}x`, read)).ok).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('does not translate a failed/invalid DB response into generation zero', async () => {
    const input = { phone, role: 'fc' };
    for (const response of [new Response('{}'), new Response('[]'), new Response('', { status: 503 })]) {
      const fetchImpl = jest.fn(async () => response) as unknown as typeof fetch;
      expect(await verifySessionGeneration(input, 'app', { supabaseUrl: 'https://local.invalid', serviceRoleKey: 'synthetic', fetchImpl }))
        .toEqual({ ok: false, reason: 'unavailable' });
    }
    expect(checkSessionGeneration(input, null)).toEqual({ ok: false, reason: 'invalid_session' });
  });
});

describe('web cookies and bridge verification endpoint', () => {
  it.each(['admin', 'manager'] as const)('preserves the %s login generation in web cookies and proxy tokens', async role => {
    const cookie = createStaffSessionValue({ role, residentDigits: phone, ...state(3, role), secret });
    const verified = verifyStaffSessionValue(cookie, { expectedRole: role, expectedResidentDigits: phone, secret });
    expect(verified).toMatchObject(state(3, role));
    expect(checkSessionGeneration({ ...verified!, phone, role }, state(4, role)).ok).toBe(false);
    const fallback = createWebGroupChatAppSessionToken(phone, role, state(3, role));
    expect((await parseAppSessionTokenDetailed(fallback!, lookup(4))).ok).toBe(false);
  });

  it('preserves FC identity and legacy generation zero without a global cookie logout', () => {
    const legacy = createFcGraphSessionValue({ fcId: id, residentDigits: phone, secret });
    const parsed = verifyFcGraphSessionValue(legacy, { secret })!;
    expect(checkSessionGeneration({ ...parsed, phone }, { ...state(), createdAt: '2000-01-01T00:00:00Z' }).ok).toBe(true);
    expect(checkSessionGeneration({ ...parsed, phone }, state(1)).ok).toBe(false);
    const cookie = createFcGraphSessionValue({ fcId: id, residentDigits: phone, secret, ...state(2) });
    expect(verifyFcGraphSessionValue(cookie, { secret })).toMatchObject(state(2));
  });

  it('returns only validity and role, and distinguishes revoked tokens from outages', async () => {
    let current = 2;
    const verify = (token: string) => parseRequestBoardBridgeTokenDetailed(token, async input => checkSessionGeneration(input, state(current)));
    const handler = createRequestBoardSessionVerificationHandler(verify);
    const bridge = await createRequestBoardBridgeToken(phone, 'fc', null, state(2));
    const request = () => new Request('https://local.invalid', { method: 'POST', body: JSON.stringify({ bridgeToken: bridge }) });
    const ok = await handler(request());
    expect(await ok.json()).toEqual({ ok: true, role: 'fc' });
    current = 3;
    expect((await handler(request())).status).toBe(401);
    const unavailable = createRequestBoardSessionVerificationHandler(async () => ({ ok: false, code: 'session_verification_unavailable', message: 'Unavailable', status: 503 }));
    expect((await unavailable(request())).status).toBe(503);
  });
});
