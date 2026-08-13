import { createHmac, timingSafeEqual } from 'node:crypto';

export const NOTIFICATION_OPEN_COOKIE = 'notification_open_resume';
export const NOTIFICATION_OPEN_MAX_AGE_SECONDS = 10 * 60;

type NotificationOpenPayload = {
  v: 1;
  notificationId: string;
  iat: number;
  exp: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const getSecret = (explicit?: string) => {
  const secret = explicit
    ?? process.env.NOTIFICATION_OPEN_SECRET
    ?? process.env.STAFF_SESSION_SECRET
    ?? process.env.FC_GRAPH_SESSION_SECRET
    ?? process.env.AUTH_SECRET
    ?? process.env.NEXTAUTH_SECRET;
  if (!secret || secret.trim().length < 16) {
    throw new Error('Notification open secret is not configured.');
  }
  return secret;
};

const sign = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export function createNotificationOpenToken(input: {
  notificationId: string;
  nowMs?: number;
  secret?: string;
}) {
  const notificationId = input.notificationId.trim().toLowerCase();
  if (!UUID_PATTERN.test(notificationId)) throw new Error('Invalid notification id.');
  const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    notificationId,
    iat: now,
    exp: now + NOTIFICATION_OPEN_MAX_AGE_SECONDS,
  } satisfies NotificationOpenPayload), 'utf8').toString('base64url');
  return `${payload}.${sign(payload, getSecret(input.secret))}`;
}

export function verifyNotificationOpenToken(input: {
  token?: string | null;
  nowMs?: number;
  secret?: string;
}): NotificationOpenPayload | null {
  const [payloadPart, signaturePart, extra] = String(input.token ?? '').trim().split('.');
  if (!payloadPart || !signaturePart || extra) return null;
  if (!safeEqual(signaturePart, sign(payloadPart, getSecret(input.secret)))) return null;
  try {
    const value = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Partial<NotificationOpenPayload>;
    const now = Math.floor((input.nowMs ?? Date.now()) / 1000);
    if (
      value.v !== 1
      || typeof value.notificationId !== 'string'
      || !UUID_PATTERN.test(value.notificationId)
      || typeof value.iat !== 'number'
      || typeof value.exp !== 'number'
      || value.iat > now + 60
      || value.exp <= now
    ) {
      return null;
    }
    return value as NotificationOpenPayload;
  } catch {
    return null;
  }
}
