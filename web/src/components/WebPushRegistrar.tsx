'use client';

import { useEffect, useRef } from 'react';

import { useSession } from '@/hooks/use-session';
import { logger } from '@/lib/logger';
import {
  getWebPushClientConfigState,
  getWebPushRegistrationFeedback,
} from '@/lib/web-push-config';

type BrowserWebPushSubscription = {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
};

const toUint8Array = (base64Url: string) => {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export type WebPushPermissionState = NotificationPermission | 'unsupported';

export const getWebPushPermissionState = (): WebPushPermissionState => {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission;
};

export async function registerWebPushSubscription(
  role: string | null | undefined,
  residentId: string | null | undefined,
  opts?: { forceResubscribe?: boolean },
) {
  const permission = getWebPushPermissionState();
  if (permission === 'unsupported') {
    return { ok: false as const, permission, message: 'unsupported' };
  }

  if (!role || !residentId) {
    return { ok: false as const, permission, message: 'missing-session' };
  }

  const clientConfig = getWebPushClientConfigState(process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY);
  if (!clientConfig.isConfigured) {
    return { ok: false as const, permission, message: clientConfig.reason };
  }

  let granted: NotificationPermission = permission;
  if (granted === 'default') {
    granted = await Notification.requestPermission();
  }
  if (granted !== 'granted') {
    return { ok: false as const, permission: granted, message: 'permission-not-granted' };
  }

  const registration = await navigator.serviceWorker.register('/sw.js');

  if (opts?.forceResubscribe) {
    const previous = await registration.pushManager.getSubscription();
    if (previous) {
      await previous.unsubscribe();
    }
  }

  let subscription = (await registration.pushManager.getSubscription()) as BrowserWebPushSubscription | null;
  if (!subscription) {
    subscription = (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toUint8Array(clientConfig.publicKey),
    })) as BrowserWebPushSubscription;
  }

  if (!subscription?.endpoint) {
    return { ok: false as const, permission: granted, message: 'missing-subscription' };
  }

  const resp = await fetch('/api/web-push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription, role, residentId }),
  });

  if (!resp.ok) {
    let reason = `subscribe-api-${resp.status}`;
    try {
      const err = (await resp.json()) as { error?: string };
      if (err?.error) reason = err.error;
    } catch {
      // no-op
    }
    return { ok: false as const, permission: granted, message: reason };
  }

  return { ok: true as const, permission: granted };
}

export function WebPushRegistrar() {
  const { role, residentId, hydrated } = useSession();
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!hydrated || registeredRef.current) return;
    if (!role || !residentId) return;

    const register = async () => {
      const result = await registerWebPushSubscription(role, residentId);
      if (!result.ok && result.message !== 'permission-not-granted' && result.message !== 'unsupported') {
        const feedback = getWebPushRegistrationFeedback(result.message);
        logger.warn(
          result.message === 'missing-vapid-key' ? '[web-push] registration skipped' : '[web-push] register failed',
          { reason: result.message, message: feedback.message },
        );
      }
    };

    register()
      .catch((err) => {
        logger.warn('[web-push] register failed', err);
      })
      .finally(() => {
        registeredRef.current = true;
      });
  }, [hydrated, residentId, role]);

  return null;
}
