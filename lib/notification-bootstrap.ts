import {
  notificationTargetsEqual,
  type NotificationTarget,
} from './notification-target';

export type NotificationCaptureIdentity = {
  notificationId: string;
  target: NotificationTarget;
};

export function notificationCaptureMatches(
  current: NotificationCaptureIdentity | null | undefined,
  expected: NotificationCaptureIdentity,
): boolean {
  return Boolean(
    current
    && current.notificationId === expected.notificationId
    && notificationTargetsEqual(current.target, expected.target),
  );
}

export async function clearNativeNotificationResponseIfCurrent<T>(input: {
  capturedResponse: T;
  getResponseKey: (response: T | null) => string;
  getCurrentResponse: () => T | null | Promise<T | null>;
  clearCurrentResponse: () => void | Promise<void>;
}): Promise<void> {
  const expectedKey = input.getResponseKey(input.capturedResponse);
  if (!expectedKey) return;
  const current = await input.getCurrentResponse();
  if (input.getResponseKey(current) !== expectedKey) return;
  await input.clearCurrentResponse();
}

export async function processNotificationResponseSafely<T>(input: {
  response: T;
  captureResponse: (response: T) => void | Promise<void>;
  clearNativeResponseIfCurrent: (response: T) => void | Promise<void>;
  onCleanupFailure?: () => void;
}): Promise<void> {
  await input.captureResponse(input.response);
  try {
    await input.clearNativeResponseIfCurrent(input.response);
  } catch {
    input.onCleanupFailure?.();
  }
}

export async function bootstrapNotificationNavigation<T>(input: {
  restorePending: () => void | Promise<void>;
  getInitialResponse: () => T | null | Promise<T | null>;
  isNotificationResponse: (response: T | null) => boolean;
  enqueueResponse: (response: T) => void | Promise<void>;
  hasPending: () => boolean;
  markReady: (hasPending: boolean) => void;
  onRestoreFailure?: () => void;
  onInitialResponseFailure?: () => void;
}): Promise<void> {
  try {
    await input.restorePending();
  } catch {
    input.onRestoreFailure?.();
  }

  try {
    const initialResponse = await input.getInitialResponse();
    if (initialResponse && input.isNotificationResponse(initialResponse)) {
      await input.enqueueResponse(initialResponse);
    }
  } catch {
    input.onInitialResponseFailure?.();
  } finally {
    input.markReady(input.hasPending());
  }
}
