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

const WEB_PUSH_TIMEOUT_MS = 8_000;

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

  const results = await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        message,
        { timeout: WEB_PUSH_TIMEOUT_MS },
      );
      return { sent: 1, failed: 0, expiredEndpoint: null as string | null };
    } catch (err: unknown) {
      const error = err as { statusCode?: number };
      logger.warn('[web-push] send failed', {
        category: 'web_push',
        reason: 'provider_rejected',
        status: typeof error?.statusCode === 'number' ? error.statusCode : 'unknown',
      });
      return {
        sent: 0,
        failed: 1,
        expiredEndpoint:
          error?.statusCode === 404 || error?.statusCode === 410
            ? sub.endpoint
            : null,
      };
    }
  }));

  const sent = results.reduce((total, result) => total + result.sent, 0);
  const failed = results.reduce((total, result) => total + result.failed, 0);
  const expired = results
    .map((result) => result.expiredEndpoint)
    .filter((endpoint): endpoint is string => Boolean(endpoint));

  return { sent, failed, expired };
}
