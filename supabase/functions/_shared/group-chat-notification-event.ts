const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_KEY_PATTERN = /^group-chat-message:[0-9a-f]{64}$/;
const RETRY_TOKEN_PATTERN = /^gcnr1\.[0-9a-f]{64}$/;
const RETRY_TOKEN_CONTEXT = 'group-chat-notification-retry:v1';

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export async function deriveGroupChatNotificationEventKey(input: {
  roomId: string;
  messageId: string;
  senderActorId: string;
  createdAt: string;
}) {
  const roomId = input.roomId.trim().toLowerCase();
  const messageId = input.messageId.trim().toLowerCase();
  const senderActorId = input.senderActorId.trim().toLowerCase();
  const createdAt = input.createdAt.trim();
  if (
    !UUID_PATTERN.test(roomId)
    || !UUID_PATTERN.test(messageId)
    || !/^(fc|manager|admin):[0-9]{11}$/.test(senderActorId)
    || !createdAt
    || !Number.isFinite(Date.parse(createdAt))
  ) {
    throw new Error('invalid_group_chat_notification_event');
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      `${roomId}\n${messageId}\n${senderActorId}\n${createdAt}`,
    ),
  );
  return `group-chat-message:${toHex(new Uint8Array(digest))}`;
}

export function isGroupChatNotificationEventKey(
  value: unknown,
): value is string {
  return typeof value === 'string' && EVENT_KEY_PATTERN.test(value.trim());
}

export function groupChatNotificationDeliveryKey(
  eventKey: string,
  recipientActorId: string,
) {
  const actorId = recipientActorId.trim().toLowerCase();
  if (
    !isGroupChatNotificationEventKey(eventKey)
    || !UUID_PATTERN.test(actorId)
  ) {
    throw new Error('invalid_group_chat_notification_delivery_key');
  }
  return `${eventKey}:${actorId}`;
}

export async function issueGroupChatNotificationRetryToken(
  eventKey: string,
  secret: string,
) {
  const normalizedEventKey = eventKey.trim();
  const signingSecret = secret.trim();
  if (
    !isGroupChatNotificationEventKey(normalizedEventKey)
    || !signingSecret
  ) {
    throw new Error('invalid_group_chat_notification_retry_signing_input');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(
      `${RETRY_TOKEN_CONTEXT}\n${normalizedEventKey}`,
    ),
  );
  return `gcnr1.${toHex(new Uint8Array(signature))}`;
}

export function isGroupChatNotificationRetryToken(
  value: unknown,
): value is string {
  return typeof value === 'string' && RETRY_TOKEN_PATTERN.test(value.trim());
}

function timingSafeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

export async function verifyGroupChatNotificationRetryToken(input: {
  eventKey: string;
  retryToken: string;
  secrets: string[];
}) {
  if (
    !isGroupChatNotificationEventKey(input.eventKey)
    || !isGroupChatNotificationRetryToken(input.retryToken)
  ) {
    return false;
  }
  const uniqueSecrets = Array.from(
    new Set(input.secrets.map((secret) => secret.trim()).filter(Boolean)),
  );
  for (const secret of uniqueSecrets) {
    const expected = await issueGroupChatNotificationRetryToken(
      input.eventKey,
      secret,
    );
    if (timingSafeEqual(expected, input.retryToken.trim())) return true;
  }
  return false;
}
