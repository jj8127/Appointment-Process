'use client';

import { useEffect, useRef } from 'react';

import { useSession } from '@/hooks/use-session';

import { logger } from '@/lib/logger';
type WebPushSubscription = {
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

export function WebPushRegistrar() {
  const { role, residentId, hydrated } = useSession();
  const registeredRef = useRef(false);

  useEffect(() => {
    if (!hydrated || registeredRef.current) return;
    if (!role || !residentId) return;
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? '';
    if (!publicKey) return;

    const register = async () => {
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
      } else if (Notification.permission !== 'granted') {
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      let subscription = (await registration.pushManager.getSubscription()) as WebPushSubscription | null;
      if (!subscription) {
        subscription = (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: toUint8Array(publicKey),
        })) as WebPushSubscription;
      }

      if (!subscription?.endpoint) return;

      await fetch('/api/web-push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription, role, residentId }),
      });
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
