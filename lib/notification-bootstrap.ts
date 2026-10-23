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

type ConsumedResponseStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

/**
 * Remembers notification taps already handled, across app restarts. Android can hand the
 * same launch response back on every cold start (reopening from recents), and an in-memory
 * guard alone replays it each time. Storage failures fall back to the in-memory set.
 */
export function createConsumedNotificationResponseStore(
  storage: ConsumedResponseStorage,
  storageKey: string,
  limit = 50,
) {
  let keys: string[] | null = null;
  const load = async () => {
    if (keys) return keys;
    try {
      const parsed: unknown = JSON.parse((await storage.getItem(storageKey)) ?? '[]');
      keys = Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
    } catch {
      keys = [];
    }
    return keys;
  };
  return {
    async has(responseKey: string) {
      return Boolean(responseKey) && (await load()).includes(responseKey);
    },
    async add(responseKey: string) {
      if (!responseKey) return;
      const current = await load();
      if (current.includes(responseKey)) return;
      keys = [...current, responseKey].slice(-limit);
      try {
        await storage.setItem(storageKey, JSON.stringify(keys));
      } catch {
        // Keep the in-memory record; the next launch may replay once.
      }
    },
  };
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
