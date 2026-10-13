export const APP_PUSH_CATEGORIES = [
  'messages',
  'request_activity',
  'notices',
  'operations',
] as const;

export type AppPushCategory = typeof APP_PUSH_CATEGORIES[number];
export type AppPreferenceActorRole = 'fc' | 'manager' | 'admin';
export type MessengerRoomKind = 'direct-thread' | 'group';

export type AppPreferenceActor = {
  id: string;
  role: AppPreferenceActorRole;
};

export type AppPreferenceActorRow = {
  actor_id: string;
  actor_role: AppPreferenceActorRole;
};
export type AppPushPreferenceRow = AppPreferenceActorRow & { enabled: boolean };
export type AppPushCategoryPreferenceRow = AppPreferenceActorRow & {
  category: AppPushCategory;
  enabled: boolean;
};
export type MessengerRoomPreferenceRow = AppPreferenceActorRow & {
  room_key: string;
  muted: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROOM_KEY_PATTERN = /^garamin:(direct-thread|group):([0-9a-f-]+)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isAppPreferenceActorRole(value: unknown): value is AppPreferenceActorRole {
  return value === 'fc' || value === 'manager' || value === 'admin';
}

export function isAppPreferenceActorRow(value: unknown): value is AppPreferenceActorRow {
  return isRecord(value)
    && typeof value.actor_id === 'string'
    && UUID_PATTERN.test(value.actor_id)
    && isAppPreferenceActorRole(value.actor_role);
}

export function isAppPushPreferenceRow(value: unknown): value is AppPushPreferenceRow {
  return isAppPreferenceActorRow(value)
    && typeof (value as Record<string, unknown>).enabled === 'boolean';
}

export function isAppPushCategoryPreferenceRow(
  value: unknown,
): value is AppPushCategoryPreferenceRow {
  return isAppPushPreferenceRow(value)
    && isAppPushCategory((value as Record<string, unknown>).category);
}

export function isMessengerRoomPreferenceRow(
  value: unknown,
): value is MessengerRoomPreferenceRow {
  return isAppPreferenceActorRow(value)
    && typeof (value as Record<string, unknown>).room_key === 'string'
    && parseMessengerRoomKey((value as Record<string, unknown>).room_key)?.key
      === (value as Record<string, unknown>).room_key
    && typeof (value as Record<string, unknown>).muted === 'boolean';
}

export function isAppPushCategory(value: unknown): value is AppPushCategory {
  return typeof value === 'string'
    && (APP_PUSH_CATEGORIES as readonly string[]).includes(value);
}

export function buildMessengerRoomKey(kind: MessengerRoomKind, id: string) {
  const normalizedId = String(id ?? '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalizedId)) return null;
  return `garamin:${kind}:${normalizedId}` as const;
}

export function parseMessengerRoomKey(value: unknown): {
  key: string;
  kind: MessengerRoomKind;
  id: string;
} | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  const match = ROOM_KEY_PATTERN.exec(normalized);
  if (!match || !UUID_PATTERN.test(match[2])) return null;
  return {
    key: normalized,
    kind: match[1] as MessengerRoomKind,
    id: match[2],
  };
}

export function matchesAppPreferenceActor(
  row: { actor_id?: string; actor_role?: string },
  actor: AppPreferenceActor,
) {
  return row.actor_id === actor.id && row.actor_role === actor.role;
}

export function evaluateNotificationPreference(input: {
  actor: AppPreferenceActor;
  category: AppPushCategory;
  roomKey?: string | null;
  globalRows?: Array<{ actor_id?: string; actor_role?: string; enabled?: boolean }> | null;
  categoryRows?: Array<{
    actor_id?: string;
    actor_role?: string;
    category?: string;
    enabled?: boolean;
  }> | null;
  roomRows?: Array<{
    actor_id?: string;
    actor_role?: string;
    room_key?: string;
    muted?: boolean;
  }> | null;
}) {
  const globalRow = (input.globalRows ?? []).find((row) =>
    matchesAppPreferenceActor(row, input.actor)
  );
  const categoryRow = (input.categoryRows ?? []).find((row) =>
    matchesAppPreferenceActor(row, input.actor) && row.category === input.category
  );
  const roomRow = input.roomKey
    ? (input.roomRows ?? []).find((row) =>
      matchesAppPreferenceActor(row, input.actor) && row.room_key === input.roomKey
    )
    : null;
  const roomMuted = roomRow?.muted === true;
  const pushEnabled = globalRow?.enabled !== false && categoryRow?.enabled !== false;
  return {
    globalEnabled: globalRow?.enabled !== false,
    categoryEnabled: categoryRow?.enabled !== false,
    roomMuted,
    suppressInbox: roomMuted,
    suppressExpo: roomMuted || !pushEnabled,
  };
}
