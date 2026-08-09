import { getStoredAppSessionToken } from './request-board-api';
import { supabase } from './supabase';
import { unregisterAllPushTokens } from './notifications';

export const PUSH_CATEGORIES = [
  'messages',
  'request_activity',
  'notices',
  'operations',
] as const;

export type PushCategory = typeof PUSH_CATEGORIES[number];
export type NotificationPreferenceActorRole = 'fc' | 'manager' | 'admin';
export type MessengerRoomRef =
  | { kind: 'direct-thread'; id: string; key: `garamin:direct-thread:${string}` }
  | { kind: 'group'; id: string; key: `garamin:group:${string}` };

export type MessengerRoomPreference = {
  roomKey: string;
  muted: boolean;
  pinnedAt?: string | null;
  leftAt?: string | null;
  updatedAt: string;
};

export type NotificationPreferences = {
  actor: { id: string; role: NotificationPreferenceActorRole };
  globalPushEnabled: boolean;
  categories: Record<PushCategory, boolean>;
  rooms: MessengerRoomPreference[];
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isRfc3339Timestamp(value: unknown): value is string {
  return typeof value === 'string'
    && RFC3339_TIMESTAMP_PATTERN.test(value)
    && Number.isFinite(Date.parse(value));
}

export function buildMessengerRoomRef(
  kind: MessengerRoomRef['kind'],
  rawId: string,
): MessengerRoomRef {
  const id = String(rawId ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(id)) throw new Error('invalid_messenger_room_id');
  return kind === 'direct-thread'
    ? { kind, id, key: `garamin:direct-thread:${id}` }
    : { kind, id, key: `garamin:group:${id}` };
}

function isPreferences(value: unknown): value is NotificationPreferences & { ok: true } {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  const actor = data.actor as Record<string, unknown> | undefined;
  const categories = data.categories as Record<string, unknown> | undefined;
  const rooms = data.rooms;
  const categoryKeys = categories ? Object.keys(categories) : [];
  if (
    data.ok !== true
    || typeof actor?.id !== 'string'
    || !UUID_PATTERN.test(actor.id)
    || !['fc', 'manager', 'admin'].includes(String(actor?.role))
    || typeof data.globalPushEnabled !== 'boolean'
    || categoryKeys.length !== PUSH_CATEGORIES.length
    || !PUSH_CATEGORIES.every((category) => typeof categories?.[category] === 'boolean')
    || !Array.isArray(rooms)
  ) return false;

  const seenRoomKeys = new Set<string>();
  return rooms.every((rawRoom) => {
    if (!rawRoom || typeof rawRoom !== 'object' || Array.isArray(rawRoom)) return false;
    const room = rawRoom as Record<string, unknown>;
    const roomKeys = Object.keys(room);
    const legacyRoom = roomKeys.length === 3;
    const currentRoom = roomKeys.length === 5;
    if (
      (!legacyRoom && !currentRoom)
      || typeof room.roomKey !== 'string'
      || typeof room.muted !== 'boolean'
      || (legacyRoom && room.muted !== true)
      || (currentRoom && !(
        (room.pinnedAt === null || typeof room.pinnedAt === 'string')
        && (room.leftAt === null || typeof room.leftAt === 'string')
      ))
      || !isRfc3339Timestamp(room.updatedAt)
      || !/^garamin:(direct-thread|group):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(room.roomKey)
      || (typeof room.pinnedAt === 'string' && !isRfc3339Timestamp(room.pinnedAt))
      || (typeof room.leftAt === 'string' && !isRfc3339Timestamp(room.leftAt))
      || seenRoomKeys.has(room.roomKey)
    ) return false;
    seenRoomKeys.add(room.roomKey);
    return true;
  });
}

async function invokePreferences(body: Record<string, unknown>): Promise<NotificationPreferences> {
  const sessionToken = await getStoredAppSessionToken();
  if (!sessionToken) throw new Error('notification_preferences_session_unavailable');
  const { data, error } = await supabase.functions.invoke('notification-preferences', {
    body,
    headers: { 'x-app-session-token': sessionToken },
  });
  if (error || !isPreferences(data)) throw new Error('notification_preferences_request_failed');
  return data;
}

export function getNotificationPreferences() {
  return invokePreferences({ action: 'bootstrap' });
}

export async function setGlobalPushEnabled(enabled: boolean) {
  const preferences = await invokePreferences({ action: 'set_global', enabled });
  if (!enabled) {
    const unregisterResult = await unregisterAllPushTokens();
    if (!unregisterResult.ok) throw new Error('push_token_unregister_failed');
  }
  return preferences;
}

export function setPushCategoryEnabled(category: PushCategory, enabled: boolean) {
  if (!PUSH_CATEGORIES.includes(category)) throw new Error('invalid_push_category');
  return invokePreferences({ action: 'set_category', category, enabled });
}

export function setRoomMuted(roomRef: MessengerRoomRef, muted: boolean) {
  const canonical = buildMessengerRoomRef(roomRef.kind, roomRef.id);
  if (canonical.key !== roomRef.key) throw new Error('invalid_messenger_room_ref');
  return invokePreferences({ action: 'set_room', roomKey: canonical.key, muted });
}

export function setRoomPinned(roomRef: MessengerRoomRef, pinned: boolean) {
  const canonical = buildMessengerRoomRef(roomRef.kind, roomRef.id);
  if (canonical.key !== roomRef.key) throw new Error('invalid_messenger_room_ref');
  return invokePreferences({ action: 'set_room_pinned', roomKey: canonical.key, pinned });
}

export function leaveRoom(roomRef: MessengerRoomRef) {
  const canonical = buildMessengerRoomRef(roomRef.kind, roomRef.id);
  if (canonical.key !== roomRef.key) throw new Error('invalid_messenger_room_ref');
  return invokePreferences({ action: 'leave_room', roomKey: canonical.key });
}

export async function getMutedMessengerRooms() {
  const preferences = await getNotificationPreferences();
  return preferences.rooms.filter((room): room is MessengerRoomPreference => room.muted === true);
}
