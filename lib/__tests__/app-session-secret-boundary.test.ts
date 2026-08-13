import { createHmac } from 'node:crypto';

import {
  createAppSessionToken,
  parseAppSessionTokenDetailed,
} from '../../supabase/functions/_shared/request-board-auth';
import { createWebGroupChatAppSessionToken } from '../../web/src/lib/request-board-app-session';

const ENV_KEYS = [
  'FC_APP_SESSION_TOKEN_SECRET',
  'FC_APP_SESSION_TOKEN_PREVIOUS_SECRET',
  'FC_APP_SESSION_TTL_SEC',
  'REQUEST_BOARD_AUTH_BRIDGE_SECRET',
  'REQUEST_BOARD_BRIDGE_TOKEN_SECRET',
  'REQUEST_BOARD_BRIDGE_TOKEN_PREVIOUS_SECRET',
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

const buildSignedToken = (payload: Record<string, unknown>, secret: string) => {
  const payloadPart = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signaturePart = createHmac('sha256', secret).update(payloadPart).digest('base64url');
  return `${payloadPart}.${signaturePart}`;
};

const buildPayload = (overrides: Record<string, unknown> = {}) => {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    kind: 'fc_onboarding_session',
    phone: '01012345678',
    role: 'admin',
    staffType: 'admin',
    iat: nowSec,
    exp: nowSec + 600,
    ...overrides,
  };
};

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('app-session HMAC key separation', () => {
  it('does not mint or accept an admin app session from the legacy bridge secret', async () => {
    process.env.REQUEST_BOARD_AUTH_BRIDGE_SECRET = 'legacy-shared-bridge-secret';

    await expect(createAppSessionToken('01012345678', 'admin', 'admin')).resolves.toBeNull();
    expect(createWebGroupChatAppSessionToken('01012345678', 'admin')).toBeNull();

    const forgedAdminToken = buildSignedToken(
      buildPayload(),
      process.env.REQUEST_BOARD_AUTH_BRIDGE_SECRET,
    );
    await expect(parseAppSessionTokenDetailed(forgedAdminToken)).resolves.toMatchObject({
      ok: false,
      code: 'invalid_app_session',
    });
  });

  it('mints with and verifies only the dedicated current app-session key', async () => {
    process.env.FC_APP_SESSION_TOKEN_SECRET = 'dedicated-current-app-session-secret';
    process.env.REQUEST_BOARD_AUTH_BRIDGE_SECRET = 'unrelated-legacy-bridge-secret';

    const edgeToken = await createAppSessionToken('01012345678', 'admin', 'developer');
    expect(edgeToken).toBeTruthy();
    await expect(parseAppSessionTokenDetailed(edgeToken!)).resolves.toMatchObject({
      ok: true,
      payload: {
        kind: 'fc_onboarding_session',
        phone: '01012345678',
        role: 'admin',
        staffType: 'developer',
      },
    });

    const webToken = createWebGroupChatAppSessionToken('01012345678', 'admin');
    expect(webToken).toBeTruthy();
    await expect(parseAppSessionTokenDetailed(webToken!)).resolves.toMatchObject({
      ok: true,
      payload: {
        kind: 'fc_onboarding_session',
        phone: '01012345678',
        role: 'admin',
      },
    });
  });

  it('accepts the dedicated previous app-session key only for verification rotation', async () => {
    process.env.FC_APP_SESSION_TOKEN_SECRET = 'dedicated-current-app-session-secret';
    process.env.FC_APP_SESSION_TOKEN_PREVIOUS_SECRET = 'dedicated-previous-app-session-secret';

    const previousKeyToken = buildSignedToken(
      buildPayload({ role: 'manager', staffType: undefined }),
      process.env.FC_APP_SESSION_TOKEN_PREVIOUS_SECRET,
    );
    await expect(parseAppSessionTokenDetailed(previousKeyToken)).resolves.toMatchObject({
      ok: true,
      payload: {
        kind: 'fc_onboarding_session',
        phone: '01012345678',
        role: 'manager',
      },
    });
  });
});
