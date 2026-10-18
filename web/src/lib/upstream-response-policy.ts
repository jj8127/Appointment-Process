export { isBoardSuccess } from './board-response-contract.ts';
import {
  parseGroupMessengerMessage,
  parseGroupMessengerMessageList,
  parseGroupMessengerReactionList,
} from './messenger-message-contract.ts';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const nullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const timestamp = (value: unknown): value is string =>
  nonEmptyString(value) && Number.isFinite(Date.parse(value));
const nullableTimestamp = (value: unknown): value is string | null =>
  value === null || timestamp(value);
const nonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const groupChatRole = (value: unknown) =>
  value === 'fc' || value === 'manager' || value === 'admin';

function groupChatActor(value: unknown) {
  return record(value)
    && nonEmptyString(value.id)
    && groupChatRole(value.role)
    && typeof value.phone === 'string'
    && nullableString(value.name);
}

function groupChatRoom(value: unknown): value is Record<string, unknown> & {
  id: string;
  slug: string;
  title: string;
} {
  return record(value)
    && nonEmptyString(value.id)
    && nonEmptyString(value.slug)
    && nonEmptyString(value.title);
}

function groupChatMember(value: unknown): value is Record<string, unknown> & {
  actor_id: string;
} {
  return record(value)
    && nonEmptyString(value.actor_id)
    && groupChatRole(value.role)
    && typeof value.phone === 'string'
    && nullableString(value.name)
    && nullableString(value.headquarters)
    && typeof value.appointment_label === 'string'
    && typeof value.can_send_messages === 'boolean';
}

function groupChatNotice(value: unknown): value is Record<string, unknown> & {
  room_id: string;
  message_id: string;
} {
  if (!record(value)) return false;
  const message = parseGroupMessengerMessage(value.message);
  return nonEmptyString(value.room_id)
    && nonEmptyString(value.message_id)
    && nonEmptyString(value.created_by_actor_id)
    && groupChatRole(value.created_by_role)
    && timestamp(value.created_at)
    && timestamp(value.updated_at)
    && message !== null
    && message.id === value.message_id
    && message.room_id === value.room_id;
}

function groupChatSearchResult(value: unknown) {
  return record(value)
    && value.source === 'garamin_group'
    && record(value.ref)
    && value.ref.version === 1
    && value.ref.kind === 'group_chat'
    && nonEmptyString(value.ref.roomId)
    && nonEmptyString(value.messageId)
    && timestamp(value.sentAt)
    && typeof value.excerpt === 'string'
    && nonEmptyString(value.roomLabel)
    && nonEmptyString(value.senderLabel);
}

function groupChatDelivery(value: unknown) {
  return record(value)
    && typeof value.notificationStored === 'boolean'
    && (
      value.pushStatus === 'accepted'
      || value.pushStatus === 'no_registered_device'
      || value.pushStatus === 'provider_rejected'
      || value.pushStatus === 'not_attempted'
    )
    && typeof value.retryable === 'boolean'
    && (
      value.notificationIds === undefined
      || (Array.isArray(value.notificationIds) && value.notificationIds.every(nonEmptyString))
    );
}

function groupChatNotification(value: unknown) {
  return record(value)
    && typeof value.ok === 'boolean'
    && (
      value.status === 'skipped'
      || value.status === 'inbox_only'
      || value.status === 'provider_accepted'
      || value.status === 'partial'
    )
    && nonNegativeInteger(value.recipient_count)
    && nonNegativeInteger(value.notification_count)
    && nonNegativeInteger(value.push_token_count)
    && nonNegativeInteger(value.push_accepted_count)
    && nonNegativeInteger(value.push_rejected_count)
    && groupChatDelivery(value.delivery);
}

function groupChatReadReceipt(value: unknown) {
  return record(value)
    && nonEmptyString(value.room_id)
    && nonEmptyString(value.actor_id)
    && timestamp(value.last_read_at)
    && nullableString(value.last_read_message_id);
}

function groupChatBootstrap(value: Record<string, unknown>) {
  if (!groupChatActor(value.actor) || !groupChatRoom(value.room)) return false;
  const messages = parseGroupMessengerMessageList(value.messages);
  const lastMessage = value.last_message === null
    ? null
    : parseGroupMessengerMessage(value.last_message);
  const members = Array.isArray(value.members) && value.members.every(groupChatMember)
    ? value.members
    : null;
  if (!messages || !members) return false;
  const roomId = value.room.id;
  return typeof value.can_send_messages === 'boolean'
    && nonNegativeInteger(value.member_count)
    && value.member_count === members.length
    && new Set(members.map((member) => member.actor_id)).size === members.length
    && typeof value.muted === 'boolean'
    && nonNegativeInteger(value.unread_count)
    && nullableTimestamp(value.last_read_at)
    && (value.last_message === null || lastMessage !== null)
    && (value.notice === null || groupChatNotice(value.notice))
    && messages.every((message) => message.room_id === roomId)
    && (!lastMessage || lastMessage.room_id === roomId)
    && (value.notice === null || value.notice.room_id === roomId);
}

/** A transport 200 is never substituted for an upstream acknowledgement. */
export function parseUpstreamResponse(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return record(value) && typeof value.ok === 'boolean' ? value : null;
  } catch { return null; }
}

export function isGroupChatSuccess(type: unknown, value: unknown): boolean {
  if (!record(value) || value.ok !== true) return false;
  switch (type) {
    case 'group_chat_bootstrap': return groupChatBootstrap(value);
    case 'group_chat_send': case 'group_chat_delete':
      return parseGroupMessengerMessage(value.message) !== null
        && (type !== 'group_chat_send'
          || (record(value.read_state)
            && typeof value.read_state.updated === 'boolean'
            && groupChatNotification(value.notification)
            && groupChatDelivery(value.delivery)));
    case 'group_chat_preferences': return typeof value.muted === 'boolean';
    case 'group_chat_reaction_set': return parseGroupMessengerReactionList(value.reactions) !== null;
    case 'group_chat_member_send_permission': return groupChatMember(value.member);
    case 'group_chat_notice_set': return groupChatNotice(value.notice);
    case 'group_chat_notice_clear': return value.notice === null;
    case 'group_chat_mark_read':
      return value.read_state === undefined || groupChatReadReceipt(value.read_state);
    case 'group_chat_notification_retry':
      return groupChatNotification(value.notification) && groupChatDelivery(value.delivery);
    case 'group_chat_search':
      return Array.isArray(value.results)
        && value.results.every(groupChatSearchResult)
        && value.coverage === 'bounded_first_page'
        && value.nextCursor === null;
    case 'group_chat_context': {
      const messages = parseGroupMessengerMessageList(value.messages);
      const roomRef = value.roomRef;
      if (!record(roomRef) || !nonEmptyString(roomRef.roomId)) return false;
      return roomRef.version === 1
        && roomRef.kind === 'group_chat'
        && nonEmptyString(value.anchorMessageId)
        && messages !== null
        && messages.some((message) => message.id === value.anchorMessageId)
        && messages.every((message) => message.room_id === roomRef.roomId)
        && typeof value.hasBefore === 'boolean'
        && typeof value.hasAfter === 'boolean'
        && value.nextCursor === null;
    }
    default: return false;
  }
}

/** Once the primary transaction commits, rejected cleanup cannot undo it. */
export async function cleanupFailed(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    const result = await operation();
    return record(result) && Boolean(result.error);
  } catch { return true; }
}
