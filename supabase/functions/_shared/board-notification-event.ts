const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_KEY_PATTERN = /^board-post:[0-9a-f]{64}$/;

export const BOARD_NOTIFICATION_ROLES = ['fc', 'admin', 'manager'] as const;
export type BoardNotificationRole = (typeof BOARD_NOTIFICATION_ROLES)[number];

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function deriveBoardNotificationEventKey(input: {
  postId: string;
  updatedAt: string;
}) {
  const postId = input.postId.trim().toLowerCase();
  const updatedAt = input.updatedAt.trim();
  if (
    !UUID_PATTERN.test(postId)
    || !updatedAt
    || !Number.isFinite(Date.parse(updatedAt))
  ) {
    throw new Error('invalid_board_notification_event');
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${postId}\n${updatedAt}`),
  );
  return `board-post:${toHex(new Uint8Array(digest))}`;
}

export function isBoardNotificationEventKey(value: unknown): value is string {
  return typeof value === 'string' && EVENT_KEY_PATTERN.test(value.trim());
}

export function boardNotificationDeliveryKey(
  eventKey: string,
  role: BoardNotificationRole,
) {
  if (!isBoardNotificationEventKey(eventKey) || !BOARD_NOTIFICATION_ROLES.includes(role)) {
    throw new Error('invalid_board_notification_delivery_key');
  }
  return `${eventKey}:${role}`;
}
