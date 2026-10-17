import {
  buildAssistedPasswordChangeTokenPayload,
  buildRequestBoardPasswordSyncAssertionPayload,
  buildRequestBoardPasswordSyncV2AssertionPayload,
  createAssistedPasswordChangeChallenge,
  createRequestBoardPasswordSyncAssertion,
  createRequestBoardAccountRetirementAssertion,
  parseAssistedPasswordChangeTokenDetailed,
  parseDesignerCompanyNameFromAffiliation,
} from '../request-board-auth';
import { buildFcPasswordSyncUpstream } from '../request-board-password-sync';
import {
  fcAccountDeletionRetirementOperationId,
  retireFcBeforeAccountDeletion,
} from '../request-board-fc-retirement';

describe('administrator-assisted first-password challenge contract', () => {
  it('signs account retirement with a distinct purpose, exact source/operation and no phone or password fields', async () => {
    const original = process.env.REQUEST_BOARD_PASSWORD_SYNC_ASSERTION_SECRET;
    process.env.REQUEST_BOARD_PASSWORD_SYNC_ASSERTION_SECRET = 'synthetic-retirement-secret';
    try {
      const token = await createRequestBoardAccountRetirementAssertion('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
      expect(token).not.toBeNull();
      const payload = JSON.parse(Buffer.from(token!.split('.')[0], 'base64url').toString('utf8'));
      expect(payload).toMatchObject({kind:'request_board_account_retirement',purpose:'retire_all_affiliates',
        upstream_account_id:'11111111-1111-4111-8111-111111111111',operation_id:'22222222-2222-4222-8222-222222222222',
        role:'fc',policyVersion:'2026-10-14'});
      expect(payload.exp-payload.iat).toBe(60);
      expect(buildFcPasswordSyncUpstream(payload.upstream_account_id.toUpperCase(),7)?.accountId)
        .toBe(`fc:${payload.upstream_account_id}`);
      expect(Object.keys(payload).sort()).toEqual(['exp','iat','kind','operation_id','policyVersion','purpose','role','upstream_account_id']);
      const withPhone = await createRequestBoardAccountRetirementAssertion('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','01000000000');
      expect(JSON.parse(Buffer.from(withPhone!.split('.')[0], 'base64url').toString('utf8')).phone).toBe('01000000000');
      const malformed = await createRequestBoardAccountRetirementAssertion('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','010-0000-0000');
      expect(JSON.parse(Buffer.from(malformed!.split('.')[0], 'base64url').toString('utf8'))).not.toHaveProperty('phone');
      delete process.env.REQUEST_BOARD_PASSWORD_SYNC_ASSERTION_SECRET;
      expect(await createRequestBoardAccountRetirementAssertion('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222')).toBeNull();
    } finally {
      if(original === undefined) delete process.env.REQUEST_BOARD_PASSWORD_SYNC_ASSERTION_SECRET;
      else process.env.REQUEST_BOARD_PASSWORD_SYNC_ASSERTION_SECRET = original;
    }
  });
  it('binds the FC, phone, purpose, nonce, and short expiry without granting an app role', () => {
    expect(buildAssistedPasswordChangeTokenPayload({
      phone: '010-0000-0000',
      fcId: '11111111-1111-4111-8111-111111111111',
      nonce: 'nonce-value-at-least-thirty-two-characters',
      nowSec: 1_800_000_000,
      ttlSec: 900,
    })).toEqual({
      kind: 'fc_assisted_password_change',
      purpose: 'replace_temporary_password',
      phone: '01000000000',
      fcId: '11111111-1111-4111-8111-111111111111',
      nonce: 'nonce-value-at-least-thirty-two-characters',
      iat: 1_800_000_000,
      exp: 1_800_000_900,
    });
  });

  it('signs a short-lived challenge that parses only as the password-change kind', async () => {
    const originalSecret = process.env.FC_APP_SESSION_TOKEN_SECRET;
    process.env.FC_APP_SESSION_TOKEN_SECRET = 'test-only-app-session-secret-with-sufficient-length';
    try {
      const challenge = await createAssistedPasswordChangeChallenge(
        '01000000000',
        '11111111-1111-4111-8111-111111111111',
      );
      expect(challenge?.nonceHash).toMatch(/^[a-f0-9]{64}$/);
      const parsed = await parseAssistedPasswordChangeTokenDetailed(challenge?.token ?? '');
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.payload.kind).toBe('fc_assisted_password_change');
        expect(parsed.payload.purpose).toBe('replace_temporary_password');
        expect(parsed.payload).not.toHaveProperty('role');
      }
    } finally {
      if (originalSecret === undefined) {
        delete process.env.FC_APP_SESSION_TOKEN_SECRET;
      } else {
        process.env.FC_APP_SESSION_TOKEN_SECRET = originalSecret;
      }
    }
  });
});

describe('request_board designer affiliation contract', () => {
  it('derives the designer company from the GaramIn bootstrap affiliation marker', () => {
    expect(parseDesignerCompanyNameFromAffiliation('동양생명 설계매니저')).toBe('동양생명');
    expect(parseDesignerCompanyNameFromAffiliation(' 롯데손보: 설계매니저 ')).toBe('롯데손보');
  });

  it('does not classify ordinary FC affiliations as request_board designers', () => {
    expect(parseDesignerCompanyNameFromAffiliation('동양생명')).toBeNull();
    expect(parseDesignerCompanyNameFromAffiliation('1본부 김형수')).toBeNull();
    expect(parseDesignerCompanyNameFromAffiliation(null)).toBeNull();
  });
});

describe('request_board password-sync assertion contract', () => {
  it('binds identity, upstream role, purpose, nonce, and a short expiry', () => {
    expect(buildRequestBoardPasswordSyncAssertionPayload({
      phone: '000-0000-0000',
      role: 'manager',
      nonce: 'nonce_value_1234567890',
      nowSec: 1_800_000_000,
      ttlSec: 60,
    })).toEqual({
      kind: 'request_board_password_sync',
      purpose: 'password_sync',
      phone: '00000000000',
      role: 'manager',
      nonce: 'nonce_value_1234567890',
      iat: 1_800_000_000,
      exp: 1_800_000_060,
    });
  });

  it('uses an incompatible v2 kind and binds the opaque account, generation, and operation', () => {
    expect(buildRequestBoardPasswordSyncV2AssertionPayload({
      phone: '000-0000-0000',
      role: 'fc',
      nonce: 'nonce_value_1234567890',
      upstreamAccountId: 'fc:11111111-1111-4111-8111-111111111111',
      upstreamCredentialVersion: 1_800_000_000_123_456,
      operationId: '22222222-2222-4222-8222-222222222222',
      nowSec: 1_800_000_000,
      ttlSec: 60,
    })).toEqual({
      kind: 'request_board_password_sync_v2',
      purpose: 'password_sync_v2',
      phone: '00000000000',
      role: 'fc',
      nonce: 'nonce_value_1234567890',
      upstream_account_id: 'fc:11111111-1111-4111-8111-111111111111',
      upstream_credential_version: 1_800_000_000_123_456,
      operation_id: '22222222-2222-4222-8222-222222222222',
      iat: 1_800_000_000,
      exp: 1_800_000_060,
    });
  });

  it('fails closed without the dedicated password-sync assertion secret', async () => {
    const originalAssertionSecret = process.env.REQUEST_BOARD_PASSWORD_SYNC_ASSERTION_SECRET;
    const originalBridgeSecret = process.env.REQUEST_BOARD_BRIDGE_TOKEN_SECRET;
    delete process.env.REQUEST_BOARD_PASSWORD_SYNC_ASSERTION_SECRET;
    process.env.REQUEST_BOARD_BRIDGE_TOKEN_SECRET = 'bridge-secret-must-not-sign-password-sync';

    try {
      await expect(
        createRequestBoardPasswordSyncAssertion('000-0000-0000', 'fc'),
      ).resolves.toBeNull();
    } finally {
      if (originalAssertionSecret === undefined) {
        delete process.env.REQUEST_BOARD_PASSWORD_SYNC_ASSERTION_SECRET;
      } else {
        process.env.REQUEST_BOARD_PASSWORD_SYNC_ASSERTION_SECRET = originalAssertionSecret;
      }
      if (originalBridgeSecret === undefined) {
        delete process.env.REQUEST_BOARD_BRIDGE_TOKEN_SECRET;
      } else {
        process.env.REQUEST_BOARD_BRIDGE_TOKEN_SECRET = originalBridgeSecret;
      }
    }
  });
});

describe('FC hard-deletion GaramLink retirement guard', () => {
  const fcId = '11111111-1111-4111-8111-111111111111';
  const envNames = ['REQUEST_BOARD_PASSWORD_SYNC_ASSERTION_SECRET', 'REQUEST_BOARD_PASSWORD_SYNC_URL', 'REQUEST_BOARD_PASSWORD_SYNC_TOKEN'] as const;
  const original = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  beforeEach(() => {
    process.env.REQUEST_BOARD_PASSWORD_SYNC_ASSERTION_SECRET = 'synthetic-retirement-secret';
    process.env.REQUEST_BOARD_PASSWORD_SYNC_URL = 'https://garamlink.example.test/api/auth/sync-password';
    process.env.REQUEST_BOARD_PASSWORD_SYNC_TOKEN = 'synthetic-transport-secret';
  });
  afterEach(() => {
    for (const name of envNames) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  });
  const reply = (status: number, body: unknown) => jest.fn(async (_url: URL, _init: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const erased = (operationId: string, alreadyApplied = false) => ({ success: true, data: {
    operationId, upstreamAccountId: fcId, policyVersion: '2026-10-14', accountErased: true, runtimeRevoked: true,
    runtimeRevocationScope: 'persisted_auth_and_local_runtime', remoteSocketRevalidationIntervalMs: 5000, alreadyApplied } });

  it('derives one stable retirement operation per FC so retries replay the committed receipt', async () => {
    const operationId = await fcAccountDeletionRetirementOperationId(fcId);
    expect(operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await expect(fcAccountDeletionRetirementOperationId(fcId.toUpperCase())).resolves.toBe(operationId);
    await expect(fcAccountDeletionRetirementOperationId('22222222-2222-4222-8222-222222222222')).resolves.not.toBe(operationId);
  });

  it('signs the FC, operation and phone digits, and allows deletion only on an exact erased receipt', async () => {
    const operationId = await fcAccountDeletionRetirementOperationId(fcId);
    const fetchImpl = reply(200, erased(operationId, true));
    await expect(retireFcBeforeAccountDeletion(fcId, '010-0000-0000', fetchImpl))
      .resolves.toEqual({ ok: true, affiliateState: 'erased', preservedRole: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://garamlink.example.test/api/auth/retire-affiliate-account');
    expect((init.headers as Record<string, string>)['x-request-bridge-token']).toBe('synthetic-transport-secret');
    const assertion = JSON.parse(String(init.body)).authAssertion as string;
    expect(JSON.parse(Buffer.from(assertion.split('.')[0], 'base64url').toString('utf8')))
      .toMatchObject({ upstream_account_id: fcId, operation_id: operationId, phone: '01000000000' });
  });

  it('accepts no GaramLink account for the signed phone and a preserved designer account', async () => {
    const operationId = await fcAccountDeletionRetirementOperationId(fcId);
    const base = { operationId, upstreamAccountId: fcId, policyVersion: '2026-10-14', alreadyApplied: false };
    await expect(retireFcBeforeAccountDeletion(fcId, '01000000000', reply(200, { success: true, data: {
      ...base, status: 'no_affiliate_account', accountErased: false, runtimeRevoked: false } })))
      .resolves.toMatchObject({ ok: true, affiliateState: 'erased' });
    await expect(retireFcBeforeAccountDeletion(fcId, '01000000000', reply(200, { success: true, data: {
      ...base, status: 'company_account_preserved', preservedRole: 'designer', accountErased: false,
      runtimeRevoked: false, independentLoginAvailable: true } })))
      .resolves.toEqual({ ok: true, affiliateState: 'company_account_preserved', preservedRole: 'designer' });
  });

  it('blocks deletion when GaramLink rejects, mismatches the receipt, fails, or is not configured', async () => {
    await expect(retireFcBeforeAccountDeletion(fcId, '01000000000', reply(409, { success: false, code: 'AFFILIATE_IDENTITY_UNBOUND' })))
      .resolves.toEqual({ ok: false, reason: 'affiliate_identity_unbound' });
    await expect(retireFcBeforeAccountDeletion(fcId, '01000000000', reply(409, { success: false, code: 'AFFILIATE_RETIREMENT_CONFLICT' })))
      .resolves.toEqual({ ok: false, reason: 'affiliate_unavailable' });
    await expect(retireFcBeforeAccountDeletion(fcId, '01000000000', reply(200, erased('33333333-3333-4333-8333-333333333333'))))
      .resolves.toEqual({ ok: false, reason: 'affiliate_unavailable' });
    await expect(retireFcBeforeAccountDeletion(fcId, '01000000000', jest.fn(async () => { throw new Error('offline'); })))
      .resolves.toEqual({ ok: false, reason: 'affiliate_unavailable' });
    delete process.env.REQUEST_BOARD_PASSWORD_SYNC_TOKEN;
    const unconfigured = reply(200, erased(await fcAccountDeletionRetirementOperationId(fcId)));
    await expect(retireFcBeforeAccountDeletion(fcId, '01000000000', unconfigured))
      .resolves.toEqual({ ok: false, reason: 'affiliate_unavailable' });
    expect(unconfigured).not.toHaveBeenCalled();
  });
});
