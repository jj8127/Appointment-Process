import webpush from 'web-push';

import { logger } from '@/lib/logger';
type WebPushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

type WebPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

type WebPushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

let configInitialized = false;
let configEnabled = false;

const normalizeEnvValue = (value?: string) =>
  (value ?? '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\\n/g, '')
    .replace(/\r?\n/g, '')
    .trim();

const normalizeVapidKey = (value?: string) => normalizeEnvValue(value).replace(/\s+/g, '');

const initConfig = () => {
  if (configInitialized) return configEnabled;
  configInitialized = true;

  const publicKey = normalizeVapidKey(process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY);
  const privateKey = normalizeVapidKey(process.env.WEB_PUSH_VAPID_PRIVATE_KEY);
  const subject = normalizeEnvValue(process.env.WEB_PUSH_SUBJECT);

  if (!publicKey || !privateKey || !subject) {
    logger.warn('[web-push] missing VAPID configuration');
    configEnabled = false;
    return false;
  }

  const cfg: WebPushConfig = { publicKey, privateKey, subject };

  try {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    configEnabled = true;
    return true;
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[web-push] invalid VAPID configuration', error?.message ?? String(err));
    configEnabled = false;
    return false;
  }
};

export async function sendWebPush(
  subscriptions: WebPushSubscription[],
  payload: WebPushPayload,
) {
  if (!subscriptions.length) {
    return { sent: 0, failed: 0, expired: [] as string[] };
  }
  if (!initConfig()) {
    return { sent: 0, failed: subscriptions.length, expired: [] as string[] };
  }

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  });

  const expired: string[] = [];
  let sent = 0;
  let failed = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        message,
      );
      sent += 1;
    } catch (err: unknown) {
      const error = err as { statusCode?: number };
      failed += 1;
      if (error?.statusCode === 404 || error?.statusCode === 410) {
        expired.push(sub.endpoint);
      }
      logger.warn('[web-push] send failed', error?.statusCode ?? err);
    }
  }

  return { sent, failed, expired };
}
