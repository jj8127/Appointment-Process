type SentryCapture = (error: Error, context?: Record<string, unknown>) => void;

let captureExceptionImpl: SentryCapture | null = null;

export const setSentryCaptureException = (capture: SentryCapture | null): void => {
  captureExceptionImpl = capture;
};

const toError = (error: unknown): Error => {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error('Non-error exception captured');
};

export const captureSentryException = (error: unknown, context?: Record<string, unknown>): void => {
  captureExceptionImpl?.(toError(error), context);
};
