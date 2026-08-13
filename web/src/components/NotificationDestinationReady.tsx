'use client';

import { useEffect } from 'react';

export function NotificationDestinationReady() {
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.dispatchEvent(new Event('notification-destination-ready'));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);
  return null;
}
