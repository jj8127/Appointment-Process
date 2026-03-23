import AsyncStorage from '@react-native-async-storage/async-storage';

type NotificationCheckpointScope = {
  role: 'admin' | 'fc' | null;
  residentId?: string | null;
  requestBoardRole?: 'fc' | 'designer' | null;
};

const NOTIFICATION_CHECKPOINT_KEY_PREFIX = 'lastNotificationCheckTime';

const buildNotificationCheckpointKey = ({
  role,
  residentId,
  requestBoardRole,
}: NotificationCheckpointScope): string => {
  const normalizedRole = role ?? 'guest';
  const normalizedResidentId = (residentId ?? '').trim() || 'global';
  const normalizedRequestBoardRole = requestBoardRole ?? 'none';
  return `${NOTIFICATION_CHECKPOINT_KEY_PREFIX}:${normalizedRole}:${normalizedResidentId}:${normalizedRequestBoardRole}`;
};

export async function getNotificationCheckpoint(
  scope: NotificationCheckpointScope,
  options?: { initializeIfMissing?: boolean },
): Promise<Date> {
  const key = buildNotificationCheckpointKey(scope);
  const storedValue = await AsyncStorage.getItem(key);

  if (storedValue) {
    const parsed = new Date(storedValue);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const fallback = new Date();
  if (options?.initializeIfMissing !== false) {
    await AsyncStorage.setItem(key, fallback.toISOString());
  }
  return fallback;
}

export async function setNotificationCheckpointNow(
  scope: NotificationCheckpointScope,
): Promise<string> {
  const key = buildNotificationCheckpointKey(scope);
  const nowIso = new Date().toISOString();
  await AsyncStorage.setItem(key, nowIso);
  return nowIso;
}
