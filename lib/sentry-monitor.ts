type SentryCapture = (error: Error, context?: Record<string, unknown>) => void;
export type SentryRouteBreadcrumb = {
  category?: string;
  message?: string;
  level?: 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';
  type?: string;
  data?: Record<string, unknown>;
};
type SentryBreadcrumbCapture = (breadcrumb: SentryRouteBreadcrumb) => void;

let captureExceptionImpl: SentryCapture | null = null;
let addBreadcrumbImpl: SentryBreadcrumbCapture | null = null;

export const setSentryCaptureException = (capture: SentryCapture | null): void => {
  captureExceptionImpl = capture;
};

export const setSentryAddBreadcrumb = (capture: SentryBreadcrumbCapture | null): void => {
  addBreadcrumbImpl = capture;
};

const toError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error('Non-error exception captured');
};

export const captureSentryException = (error: unknown, context?: Record<string, unknown>): void => {
  captureExceptionImpl?.(toError(error), context);
};

export const addSentryBreadcrumb = (breadcrumb: SentryRouteBreadcrumb): void => {
  addBreadcrumbImpl?.(breadcrumb);
};
