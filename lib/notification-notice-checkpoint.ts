import AsyncStorage from '@react-native-async-storage/async-storage';

import { logger } from './logger';

export type NotificationNoticeCheckpointScope = {
  role: 'admin' | 'fc' | null;
  residentId?: string | null;
  requestBoardRole?: 'fc' | 'designer' | null;
};

type NotificationNoticeCheckpointStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const CHECKPOINT_KEY_PREFIX = 'notificationNoticeViewedAtV1';
export const NOTIFICATION_NOTICE_EPOCH = new Date(0).toISOString();

export function buildNotificationNoticeCheckpointKey({
  role,
  residentId,
  requestBoardRole,
}: NotificationNoticeCheckpointScope): string {
  const normalizedRole = role ?? 'guest';
  const normalizedResidentId = (residentId ?? '').trim() || 'global';
  const normalizedRequestBoardRole = requestBoardRole ?? 'none';
  return [
    CHECKPOINT_KEY_PREFIX,
    normalizedRole,
    normalizedResidentId,
    normalizedRequestBoardRole,
  ].join(':');
}

function normalizeCheckpoint(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function getNotificationNoticeCheckpointWithStorage(
  scope: NotificationNoticeCheckpointScope,
  storage: NotificationNoticeCheckpointStorage,
): Promise<string> {
  const storedValue = await storage.getItem(
    buildNotificationNoticeCheckpointKey(scope),
  );
  return normalizeCheckpoint(storedValue) ?? NOTIFICATION_NOTICE_EPOCH;
}

export async function advanceNotificationNoticeCheckpointWithStorage(
  scope: NotificationNoticeCheckpointScope,
  viewedAt: string,
  storage: NotificationNoticeCheckpointStorage,
): Promise<string> {
  const normalizedCandidate = normalizeCheckpoint(viewedAt);
  if (!normalizedCandidate) {
    throw new Error('Invalid notification notice checkpoint');
  }

  const key = buildNotificationNoticeCheckpointKey(scope);
  const storedValue = normalizeCheckpoint(await storage.getItem(key));
  const nextValue = storedValue
    && new Date(storedValue).getTime() >= new Date(normalizedCandidate).getTime()
    ? storedValue
    : normalizedCandidate;

  if (storedValue !== nextValue) {
    await storage.setItem(key, nextValue);
  }
  return nextValue;
}

export async function getNotificationNoticeCheckpoint(
  scope: NotificationNoticeCheckpointScope,
): Promise<string> {
  try {
    return await getNotificationNoticeCheckpointWithStorage(scope, AsyncStorage);
  } catch (error) {
    logger.warn('[notifications] notice checkpoint read failed', error);
    return NOTIFICATION_NOTICE_EPOCH;
  }
}

export async function advanceNotificationNoticeCheckpoint(
  scope: NotificationNoticeCheckpointScope,
  viewedAt: string,
): Promise<string> {
  return advanceNotificationNoticeCheckpointWithStorage(
    scope,
    viewedAt,
    AsyncStorage,
  );
}
