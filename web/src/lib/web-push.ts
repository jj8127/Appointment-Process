import webpush from 'web-push';

import { logger } from '@/lib/logger';
import { getWebPushServerConfigState } from './web-push-config';

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
let configState: {
  enabled: boolean;
  reason?: 'missing-vapid-config' | 'invalid-vapid-config';
  missingEnv?: string[];
} = {
  enabled: false,
};

const initConfig = () => {
  if (configInitialized) return configState;
  configInitialized = true;

  const serverConfig = getWebPushServerConfigState({
    publicKey: process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY,
    privateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
    subject: process.env.WEB_PUSH_SUBJECT,
  });

  if (!serverConfig.isConfigured) {
    logger.warn('[web-push] disabled: missing VAPID configuration', {
      missingEnv: serverConfig.missingEnv,
      message:
        'Preview deployments may intentionally omit these values. Production web push requires all listed env vars.',
    });
    configState = {
      enabled: false,
      reason: 'missing-vapid-config',
      missingEnv: serverConfig.missingEnv,
    };
    return configState;
  }

  const cfg: WebPushConfig = {
    publicKey: serverConfig.publicKey,
    privateKey: serverConfig.privateKey,
    subject: serverConfig.subject,
  };

  try {
    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    configState = { enabled: true };
    return configState;
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[web-push] invalid VAPID configuration', {
      message: error?.message ?? String(err),
      env: [
        'NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY',
        'WEB_PUSH_VAPID_PRIVATE_KEY',
        'WEB_PUSH_SUBJECT',
      ],
    });
    configState = { enabled: false, reason: 'invalid-vapid-config' };
    return configState;
  }
};

export async function sendWebPush(
  subscriptions: WebPushSubscription[],
  payload: WebPushPayload,
) {
  if (!subscriptions.length) {
    return { sent: 0, failed: 0, expired: [] as string[] };
  }
  const currentConfig = initConfig();
  if (!currentConfig.enabled) {
    return {
      sent: 0,
      failed: subscriptions.length,
      expired: [] as string[],
      disabledReason: currentConfig.reason,
      missingEnv: currentConfig.missingEnv ?? [],
    };
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
