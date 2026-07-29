'use client';

import { useEffect } from 'react';

export function PwaServiceWorkerRegistrar() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'production'
      || !window.isSecureContext
      || !('serviceWorker' in navigator)
    ) {
      return;
    }

    void navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).catch(() => undefined);
  }, []);

  return null;
}
