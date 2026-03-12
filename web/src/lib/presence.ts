export type WebPresenceSnapshot = {
  phone: string;
  garam_in_at: string | null;
  garam_link_at: string | null;
  last_seen_at: string | null;
  is_online: boolean;
  updated_at: string | null;
};

const STALE_PRESENCE_TIMESTAMP_MS = new Date(0).getTime();

export const normalizePresencePhone = (value: string | null | undefined): string =>
  String(value ?? '').replace(/[^0-9]/g, '');

const parseMeaningfulPresenceTimestamp = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= STALE_PRESENCE_TIMESTAMP_MS) {
    return null;
  }

  return timestamp;
};

const resolveDisplayLastSeenAt = (
  presence: Pick<
    WebPresenceSnapshot,
    'is_online' | 'last_seen_at' | 'garam_in_at' | 'garam_link_at' | 'updated_at'
  >,
): number | null => {
  const explicitLastSeenAt = parseMeaningfulPresenceTimestamp(presence.last_seen_at);
  if (explicitLastSeenAt !== null) {
    return explicitLastSeenAt;
  }

  const platformLastSeenAt = [presence.garam_in_at, presence.garam_link_at]
    .map((value) => parseMeaningfulPresenceTimestamp(value))
    .filter((value): value is number => value !== null);

  if (platformLastSeenAt.length > 0) {
    return Math.max(...platformLastSeenAt);
  }

  if (!presence.is_online) {
    return parseMeaningfulPresenceTimestamp(presence.updated_at);
  }

  return null;
};

export const formatPresenceLabel = (
  presence: Pick<
    WebPresenceSnapshot,
    'is_online' | 'last_seen_at' | 'garam_in_at' | 'garam_link_at' | 'updated_at'
  > | null | undefined,
): string | null => {
  if (!presence) {
    return null;
  }

  if (presence.is_online) {
    return '활동중';
  }

  const timestamp = resolveDisplayLastSeenAt(presence);
  if (timestamp === null) {
    return '첫 접속 전';
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return '방금 전 접속';
  if (diffMinutes < 60) return `${diffMinutes}분 전 접속`;
  if (diffHours < 24) return `${diffHours}시간 전 접속`;
  return `${diffDays}일 전 접속`;
};

export const getPresenceColor = (
  presence: Pick<WebPresenceSnapshot, 'is_online'> | null | undefined,
): string => (presence?.is_online ? '#22C55E' : '#94A3B8');
