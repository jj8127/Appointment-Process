import {
  buildRequestBoardPasswordSyncAssertionPayload,
  createRequestBoardPasswordSyncAssertion,
  parseDesignerCompanyNameFromAffiliation,
} from '../request-board-auth';

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
