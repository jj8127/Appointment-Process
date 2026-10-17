'use client';

import { ColorSchemeScript, MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './globals.css';
import { SessionProvider } from '@/hooks/use-session';
import { PwaServiceWorkerRegistrar } from '@/components/PwaServiceWorkerRegistrar';
import { SystemNotificationRetirer } from '@/components/SystemNotificationRetirer';
import { BRAND_ORANGE_TUPLE, HANWHA_ORANGE } from '@/lib/brand-colors';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <ColorSchemeScript />
        <meta name="theme-color" content={HANWHA_ORANGE} />
      </head>
      <body>
        <PwaServiceWorkerRegistrar />
        <MantineProvider
          defaultColorScheme="light"
          theme={{
            primaryColor: 'orange',
            colors: { orange: BRAND_ORANGE_TUPLE },
            fontFamily: 'Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif',
          }}
        >
          <Notifications position="top-right" />
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <SystemNotificationRetirer />
              {children}
            </SessionProvider>
          </QueryClientProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
