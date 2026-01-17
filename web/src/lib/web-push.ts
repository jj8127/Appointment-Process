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

const initConfig = () => {
  if (configInitialized) return configEnabled;
  configInitialized = true;

  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? '';
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? '';
  const subject = process.env.WEB_PUSH_SUBJECT ?? '';

  if (!publicKey || !privateKey || !subject) {
    configEnabled = false;
    return false;
  }

  const cfg: WebPushConfig = { publicKey, privateKey, subject };
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  configEnabled = true;
  return true;
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
