import * as Sentry from '@sentry/nextjs';

import { sanitizeSentryContext, sanitizeSentryEvent } from './src/lib/sentry-sanitize';
import { setSentryCaptureException } from './src/lib/sentry-monitor';

const dsn = process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
const environment = process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV || 'production';
const release = process.env.SENTRY_RELEASE?.trim() || undefined;

if (dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    sendDefaultPii: false,
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    beforeSend(event) {
      return sanitizeSentryEvent(event);
    },
  });

  setSentryCaptureException((error, context) => {
    Sentry.captureException(error, {
      extra: context ? (sanitizeSentryContext(context) as Record<string, unknown>) : undefined,
    });
  });
} else {
  setSentryCaptureException(null);
}
