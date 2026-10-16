import Constants from 'expo-constants';
import type { ComponentType } from 'react';
import * as Sentry from '@sentry/react-native';

import { sanitizeSentryContext, sanitizeSentryEvent } from '@/lib/sentry-sanitize';
import { setMessengerLatencyReporter } from '@/lib/messenger-latency';
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
    beforeSendTransaction(event) {
      return sanitizeSentryEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      return sanitizeSentryContext(breadcrumb) as typeof breadcrumb;
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
  // 메신저 지연 지표는 측정값 하나당 독립 트랜잭션으로 보낸다(tracesSampleRate 표본 추출 적용).
  setMessengerLatencyReporter((sample) => {
    const span = Sentry.startInactiveSpan({
      name: `messenger.${sample.metric}`,
      op: 'messenger.latency',
      forceTransaction: true,
      startTime: (sample.endedAtMs - sample.durationMs) / 1000,
      attributes: {
        ...sample.attributes,
        'messenger.metric': sample.metric,
        'messenger.duration_ms': sample.durationMs,
      },
    });
    span.end(sample.endedAtMs / 1000);
  });
} else {
  setSentryCaptureException(null);
  setSentryAddBreadcrumb(null);
  setMessengerLatencyReporter(null);
}

export const withSentryRoot = <T extends ComponentType<Record<string, never>>>(component: T): T => {
  if (!dsn) return component;
  return Sentry.wrap(component) as T;
};

export { Sentry };
