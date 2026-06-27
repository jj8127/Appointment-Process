import { createHmac } from 'node:crypto';

type AppSessionSourceRole = 'fc' | 'admin' | 'manager';

type AppSessionTokenPayload = {
  kind: 'fc_onboarding_session';
  phone: string;
  role: AppSessionSourceRole;
  iat: number;
  exp: number;
};

export const WEB_APP_SESSION_COOKIE = 'web_app_session';
export const WEB_APP_SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;
const DEFAULT_WEB_APP_SESSION_TTL_SECONDS = 5 * 60;

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signPayload(payloadPart: string, secret: string) {
  return createHmac('sha256', secret).update(payloadPart).digest('base64url');
}

function getRequestBoardAppSessionSecret() {
  return (process.env.REQUEST_BOARD_AUTH_BRIDGE_SECRET ?? '').trim();
}

function getWebAppSessionTtlSeconds() {
  const raw = Number((process.env.GROUP_CHAT_WEB_APP_SESSION_TTL_SEC ?? '').trim());
  return Number.isFinite(raw) && raw > 0
    ? Math.min(Math.floor(raw), 15 * 60)
    : DEFAULT_WEB_APP_SESSION_TTL_SECONDS;
}

export function createWebGroupChatAppSessionToken(phone: string, role: AppSessionSourceRole) {
  const secret = getRequestBoardAppSessionSecret();
  if (!secret) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const payload: AppSessionTokenPayload = {
    kind: 'fc_onboarding_session',
    phone,
    role,
    iat: nowSec,
    exp: nowSec + getWebAppSessionTtlSeconds(),
  };
  const payloadPart = toBase64Url(JSON.stringify(payload));
  const signaturePart = signPayload(payloadPart, secret);
  return `${payloadPart}.${signaturePart}`;
}
