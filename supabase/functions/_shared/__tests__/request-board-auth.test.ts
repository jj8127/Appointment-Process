import {
  buildAssistedPasswordChangeTokenPayload,
  buildRequestBoardPasswordSyncAssertionPayload,
  createAssistedPasswordChangeChallenge,
  createRequestBoardPasswordSyncAssertion,
  parseAssistedPasswordChangeTokenDetailed,
  parseDesignerCompanyNameFromAffiliation,
} from '../request-board-auth';

describe('administrator-assisted first-password challenge contract', () => {
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
