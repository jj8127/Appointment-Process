import { safeStorage } from './safe-storage';
import {
  isNotificationUuid,
  notificationTargetsEqual,
  parseNotificationTarget,
  type NotificationTarget,
} from './notification-target';

const PENDING_NOTIFICATION_NAVIGATION_KEY =
  'fc-onboarding/pending-notification-navigation-v1';
const PENDING_NOTIFICATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingNotificationNavigation = {
  version: 1;
  notificationId: string;
  target: NotificationTarget;
  savedAt: string;
  owner?: PendingNotificationOwnerBinding;
};

export type PendingNotificationOwnerBinding = {
  role: 'admin' | 'fc';
  residentId: string;
  sessionFingerprint?: string;
  actorId?: string;
};

let pendingStorageQueue: Promise<void> = Promise.resolve();

function withPendingStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingStorageQueue.then(operation, operation);
  pendingStorageQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function fingerprintSessionToken(token?: string | null): string | undefined {
  const normalized = String(token ?? '').trim();
  if (!normalized) return undefined;
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildPendingNotificationOwnerBinding(input: {
  role?: 'admin' | 'fc' | null;
  residentId?: string | null;
  appSessionToken?: string | null;
  actorId?: string | null;
}): PendingNotificationOwnerBinding | undefined {
  const residentId = String(input.residentId ?? '').replace(/[^0-9]/g, '');
  if (!input.role || residentId.length !== 11) return undefined;
  const actorId = isNotificationUuid(input.actorId) ? input.actorId : undefined;
  return {
    role: input.role,
    residentId,
    ...(fingerprintSessionToken(input.appSessionToken)
      ? { sessionFingerprint: fingerprintSessionToken(input.appSessionToken) }
      : {}),
    ...(actorId ? { actorId } : {}),
  };
}

export function pendingNotificationOwnerMatches(
  pendingOwner: PendingNotificationOwnerBinding | undefined,
  currentOwner: PendingNotificationOwnerBinding | undefined,
): boolean {
  if (!pendingOwner) return false;
  if (!currentOwner) return false;
  return (
    pendingOwner.role === currentOwner.role
    && pendingOwner.residentId === currentOwner.residentId
    && (
      !pendingOwner.sessionFingerprint
      || pendingOwner.sessionFingerprint === currentOwner.sessionFingerprint
    )
    && (!pendingOwner.actorId || pendingOwner.actorId === currentOwner.actorId)
  );
}

function parseOwnerBinding(input: unknown): PendingNotificationOwnerBinding | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = input as Record<string, unknown>;
  const role = value.role;
  const residentId = String(value.residentId ?? '').replace(/[^0-9]/g, '');
  if (
    (role !== 'admin' && role !== 'fc')
    || residentId.length !== 11
    || (
      value.sessionFingerprint !== undefined
      && typeof value.sessionFingerprint !== 'string'
    )
    || (
      value.actorId !== undefined
      && !isNotificationUuid(value.actorId)
    )
  ) {
    return undefined;
  }
  return {
    role,
    residentId,
    ...(typeof value.sessionFingerprint === 'string'
      ? { sessionFingerprint: value.sessionFingerprint }
      : {}),
    ...(typeof value.actorId === 'string' ? { actorId: value.actorId } : {}),
  };
}

function parsePendingNotificationNavigation(
  input: unknown,
): PendingNotificationNavigation | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (
    value.version !== 1
    || !isNotificationUuid(value.notificationId)
    || typeof value.savedAt !== 'string'
  ) {
    return null;
  }
  const target = parseNotificationTarget(value.target);
  const owner = parseOwnerBinding(value.owner);
  if (value.owner !== undefined && !owner) return null;
  const savedAtMs = Date.parse(value.savedAt);
  if (
    !target
    || !Number.isFinite(savedAtMs)
    || Date.now() - savedAtMs > PENDING_NOTIFICATION_MAX_AGE_MS
  ) {
    return null;
  }
  return {
    version: 1,
    notificationId: value.notificationId,
    target,
    savedAt: value.savedAt,
    ...(owner ? { owner } : {}),
  };
}

export function createPendingNotificationNavigation(input: {
  notificationId: string;
  target: NotificationTarget;
  owner?: PendingNotificationOwnerBinding;
}): PendingNotificationNavigation {
  if (!isNotificationUuid(input.notificationId)) {
    throw new Error('invalid_notification_id');
  }
  return {
    version: 1,
    notificationId: input.notificationId,
    target: input.target,
    savedAt: new Date().toISOString(),
    ...(input.owner ? { owner: input.owner } : {}),
  };
}

export async function savePendingNotificationNavigation(input: {
  notificationId: string;
  target: NotificationTarget;
  owner?: PendingNotificationOwnerBinding;
}): Promise<PendingNotificationNavigation> {
  const pending = createPendingNotificationNavigation(input);
  await withPendingStorageLock(() =>
    safeStorage.setItem(
      PENDING_NOTIFICATION_NAVIGATION_KEY,
      JSON.stringify(pending),
    ),
  );
  return pending;
}

async function getPendingNotificationNavigationUnlocked(): Promise<
  PendingNotificationNavigation | null
> {
  const raw = await safeStorage.getItem(PENDING_NOTIFICATION_NAVIGATION_KEY);
  if (!raw) return null;
  try {
    const parsed = parsePendingNotificationNavigation(JSON.parse(raw));
    if (!parsed) {
      await safeStorage.removeItem(PENDING_NOTIFICATION_NAVIGATION_KEY);
    }
    return parsed;
  } catch {
    await safeStorage.removeItem(PENDING_NOTIFICATION_NAVIGATION_KEY);
    return null;
  }
}

export async function getPendingNotificationNavigation(): Promise<
  PendingNotificationNavigation | null
> {
  return withPendingStorageLock(getPendingNotificationNavigationUnlocked);
}

export async function clearPendingNotificationNavigation(input?: {
  notificationId?: string;
  target?: NotificationTarget;
}): Promise<boolean> {
  return withPendingStorageLock(async () => {
    if (input?.notificationId || input?.target) {
      const pending = await getPendingNotificationNavigationUnlocked();
      if (!pending) return false;
      if (
        input.notificationId
        && pending.notificationId !== input.notificationId
      ) {
        return false;
      }
      if (input.target && !notificationTargetsEqual(pending.target, input.target)) {
        return false;
      }
    }
    await safeStorage.removeItem(PENDING_NOTIFICATION_NAVIGATION_KEY);
    return true;
  });
}
