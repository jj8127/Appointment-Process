import Constants from 'expo-constants';
import type { ComponentType } from 'react';
import * as Sentry from '@sentry/react-native';

import { sanitizeSentryContext, sanitizeSentryEvent } from '@/lib/sentry-sanitize';
import { setSentryAddBreadcrumb, setSentryCaptureException } from '@/lib/sentry-monitor';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();
const environment =
  process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT?.trim() ||
  process.env.SENTRY_ENVIRONMENT?.trim() ||
  (typeof __DEV__ !== 'undefined' && __DEV__ ? 'development' : 'production');
const release =
  process.env.EXPO_PUBLIC_SENTRY_RELEASE?.trim() ||
  process.env.SENTRY_RELEASE?.trim() ||
  `fc-onboarding-app@${Constants.expoConfig?.version ?? 'unknown'}`;

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    sendDefaultPii: false,
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.mobileReplayIntegration({
        maskAllText: true,
        maskAllImages: true,
        maskAllVectors: true,
      }),
    ],
    beforeSend(event) {
      return sanitizeSentryEvent(event);
    },
  });

  setSentryCaptureException((error, context) => {
    Sentry.captureException(error, {
      extra: context ? (sanitizeSentryContext(context) as Record<string, unknown>) : undefined,
    });
  });
  setSentryAddBreadcrumb((breadcrumb) => {
    Sentry.addBreadcrumb(sanitizeSentryContext(breadcrumb) as Parameters<typeof Sentry.addBreadcrumb>[0]);
  });
} else {
  setSentryCaptureException(null);
  setSentryAddBreadcrumb(null);
}

export const withSentryRoot = <T extends ComponentType<Record<string, never>>>(component: T): T => {
  if (!dsn) return component;
  return Sentry.wrap(component) as T;
};

export { Sentry };
