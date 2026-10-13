import { isGroupChatSuccess } from './upstream-response-policy.ts';
import { GroupChatRequestError } from './group-chat-error.ts';
import { validateMessengerAttachmentCommitResponse } from './messenger-attachment-commit.ts';
import {
  parseGroupMessengerMessage,
  parseGroupMessengerMessageList,
  parseGroupMessengerReactionList,
} from './messenger-message-contract.ts';

export type GroupChatRole = 'fc' | 'manager' | 'admin';
export type GroupChatMessageType = 'text' | 'image' | 'file';

export type GroupChatActor = {
  id: string;
  role: GroupChatRole;
  phone: string;
  name: string | null;
};

export type GroupChatMember = {
  actor_id: string;
  role: GroupChatRole;
  phone: string;
  name: string | null;
  headquarters: string | null;
  appointment_label: string;
  can_send_messages: boolean;
};

export type GroupChatRoom = {
  id: string;
  slug: string;
  title: string;
};

export type GroupChatReactionSummary = {
  reaction: string;
  count: number;
  reacted_by_me: boolean;
};

export type GroupChatMessage = {
  id: string;
  room_id: string;
  sender_actor_id: string;
  sender_role: GroupChatRole;
  sender_phone: string;
  sender_name: string | null;
  content: string;
  message_type: GroupChatMessageType;
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
  created_at: string;
  unread_count: number;
  reply_to_message_id: string | null;
  reply_to_sender_name: string | null;
  reply_to_content: string | null;
  deleted_at: string | null;
  deleted_by_actor_id: string | null;
  reactions: GroupChatReactionSummary[];
  attachments: Array<{
    id: string;
    name: string;
    size: number;
    mimeType: string;
    sha256: string;
  }>;
};

export type GroupChatNotice = {
  room_id: string;
  message_id: string;
  created_by_actor_id: string;
  created_by_role: GroupChatRole;
  created_at: string;
  updated_at: string;
  message: GroupChatMessage;
};

export type GroupChatNotificationSummary = {
  ok: boolean;
  status: 'skipped' | 'inbox_only' | 'provider_accepted' | 'partial';
  recipient_count: number;
  notification_count: number;
  push_token_count: number;
  push_accepted_count: number;
  push_rejected_count: number;
  delivery: {
    notificationStored: boolean;
    pushStatus: 'accepted' | 'no_registered_device' | 'provider_rejected' | 'not_attempted';
    retryable: boolean;
    notificationIds?: string[];
  };
};

export type GroupChatSendWarning = {
  code: 'notification_delivery_partial';
  message: string;
};

export type GroupChatNotificationRetry = {
  messageId: string;
  retryToken: string;
};

export type GroupChatSendResponse = {
  ok: true;
  message: GroupChatMessage;
  notification: GroupChatNotificationSummary;
  delivery: GroupChatNotificationSummary['delivery'];
  notificationRetry: GroupChatNotificationRetry | null;
  attachmentCommit?: unknown;
  warning: GroupChatSendWarning | null;
};

export type GroupChatNotificationRetryResponse = {
  ok: true;
  notification: GroupChatNotificationSummary;
  delivery: GroupChatNotificationSummary['delivery'];
  notificationRetry: GroupChatNotificationRetry | null;
  warning: GroupChatSendWarning | null;
};

export type GroupChatBootstrapResponse = {
  ok: true;
  room: GroupChatRoom;
  actor: GroupChatActor;
  can_send_messages: boolean;
  member_count: number;
  members: GroupChatMember[];
  muted: boolean;
  unread_count: number;
  last_read_at: string | null;
  last_message: GroupChatMessage | null;
  messages: GroupChatMessage[];
  notice: GroupChatNotice | null;
};

export type GroupChatRoomRef = {
  version: 1;
  kind: 'group_chat';
  roomId: string;
};

export type GroupChatContextResponse = {
  ok: true;
  roomRef: GroupChatRoomRef;
  anchorMessageId: string;
  messages: GroupChatMessage[];
  hasBefore: boolean;
  hasAfter: boolean;
  nextCursor: null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const expected = new Set(keys);
  return Object.keys(value).length === expected.size
    && Object.keys(value).every((key) => expected.has(key));
}

async function invokeGroupChat<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/group-chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || !isGroupChatSuccess(body.type, payload)) {
    throw new GroupChatRequestError(payload?.message ?? payload?.error ?? '단톡방 요청을 처리하지 못했습니다.', {
      code: typeof payload?.code === 'string' ? payload.code : undefined,
      status: response.status,
      raw: payload,
    });
  }

  return payload as T;
}

function invalidGroupChatMessageResponse(): never {
  throw new GroupChatRequestError('단톡방 메시지 응답이 올바르지 않습니다.', {
    code: 'invalid_group_chat_message_response',
  });
}

function requireGroupChatMessage(value: unknown): GroupChatMessage {
  return parseGroupMessengerMessage(value) ?? invalidGroupChatMessageResponse();
}

function invalidGroupChatContextResponse(): never {
  throw new GroupChatRequestError('단톡방 이전 메시지 응답이 올바르지 않습니다.', {
    code: 'invalid_group_chat_context_response',
  });
}

export function parseGroupChatContextResponse(value: unknown): GroupChatContextResponse {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'ok',
    'roomRef',
    'anchorMessageId',
    'messages',
    'hasBefore',
    'hasAfter',
    'nextCursor',
  ])) return invalidGroupChatContextResponse();

  const roomRef = value.roomRef;
  const messages = parseGroupMessengerMessageList(value.messages);
  if (
    value.ok !== true
    || !isPlainRecord(roomRef)
    || !hasExactKeys(roomRef, ['version', 'kind', 'roomId'])
    || roomRef.version !== 1
    || roomRef.kind !== 'group_chat'
    || typeof roomRef.roomId !== 'string'
    || !UUID_PATTERN.test(roomRef.roomId)
    || typeof value.anchorMessageId !== 'string'
    || !UUID_PATTERN.test(value.anchorMessageId)
    || !messages
    || messages.length > 41
    || typeof value.hasBefore !== 'boolean'
    || typeof value.hasAfter !== 'boolean'
    || value.nextCursor !== null
  ) return invalidGroupChatContextResponse();

  const roomId = roomRef.roomId.toLowerCase();
  const anchorMessageId = value.anchorMessageId.toLowerCase();
  const anchorIndex = messages.findIndex((message) => message.id === anchorMessageId);
  if (
    anchorIndex < 0
    || anchorIndex > 20
    || messages.length - anchorIndex - 1 > 20
    || messages.some((message) =>
      !UUID_PATTERN.test(message.id)
      || message.room_id !== roomId
    )
  ) return invalidGroupChatContextResponse();

  for (let index = 1; index < messages.length; index += 1) {
    const previous = messages[index - 1];
    const current = messages[index];
    const timeComparison = Date.parse(previous.created_at) - Date.parse(current.created_at);
    if (timeComparison > 0 || (timeComparison === 0 && previous.id > current.id)) {
      return invalidGroupChatContextResponse();
    }
  }

  return {
    ok: true,
    roomRef: { version: 1, kind: 'group_chat', roomId },
    anchorMessageId,
    messages: messages as GroupChatMessage[],
    hasBefore: value.hasBefore,
    hasAfter: value.hasAfter,
    nextCursor: null,
  };
}

export async function groupChatBootstrap(limit = 80) {
  const result = await invokeGroupChat<GroupChatBootstrapResponse>({
    type: 'group_chat_bootstrap',
    limit,
  });
  const messages = parseGroupMessengerMessageList(result.messages);
  const lastMessage = result.last_message === null
    ? null
    : parseGroupMessengerMessage(result.last_message);
  const noticeMessage = result.notice === null
    ? null
    : parseGroupMessengerMessage(result.notice?.message);
  if (!messages
    || (result.last_message !== null && !lastMessage)
    || (result.notice !== null && !noticeMessage)
    || messages.some((message) => message.room_id !== result.room.id)
    || (lastMessage && lastMessage.room_id !== result.room.id)
    || (noticeMessage && noticeMessage.room_id !== result.room.id)) {
    return invalidGroupChatMessageResponse();
  }
  return {
    ...result,
    messages,
    last_message: lastMessage,
    notice: result.notice && noticeMessage
      ? { ...result.notice, message: noticeMessage }
      : null,
  };
}

export async function groupChatContext(roomId: string, messageId: string) {
  const normalizedRoomId = roomId.trim().toLowerCase();
  const normalizedMessageId = messageId.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalizedRoomId) || !UUID_PATTERN.test(normalizedMessageId)) {
    throw new GroupChatRequestError('단톡방 또는 메시지 정보가 올바르지 않습니다.', {
      code: 'invalid_group_chat_context',
    });
  }
  const result = await invokeGroupChat<unknown>({
    type: 'group_chat_context',
    room_id: normalizedRoomId,
    message_id: normalizedMessageId,
  });
  return parseGroupChatContextResponse(result);
}

export async function groupChatSend(input: {
  content: string;
  messageType?: GroupChatMessageType;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  replyToMessageId?: string | null;
  attachmentIntentIds?: string[];
  deliveryKey?: string;
  payloadFingerprint?: string;
}) {
  const rawResult = await invokeGroupChat<GroupChatSendResponse>({
    type: 'group_chat_send',
    content: input.content,
    message_type: input.messageType ?? 'text',
    ...(input.fileUrl ? { file_url: input.fileUrl } : {}),
    ...(input.fileName ? { file_name: input.fileName } : {}),
    ...(typeof input.fileSize === 'number' ? { file_size: input.fileSize } : {}),
    ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
    ...(input.attachmentIntentIds?.length
      ? {
          attachment_intent_ids: input.attachmentIntentIds,
          delivery_key: input.deliveryKey,
          payload_fingerprint: input.payloadFingerprint,
        }
      : {}),
  });
  const result = { ...rawResult, message: requireGroupChatMessage(rawResult.message) };
  if (
    input.attachmentIntentIds?.length
    && !validateMessengerAttachmentCommitResponse({
      attachmentCommit: result.attachmentCommit,
      message: result.message,
      expectedAttachmentCount: input.attachmentIntentIds.length,
    })
  ) {
    throw new GroupChatRequestError(
      '서버가 첨부 파일 저장을 확인하지 못했습니다.',
      { code: 'invalid_attachment_commit_response' },
    );
  }
  return result;
}

export async function groupChatRetryNotification(retry: GroupChatNotificationRetry) {
  return invokeGroupChat<GroupChatNotificationRetryResponse>({
    type: 'group_chat_notification_retry',
    message_id: retry.messageId,
    retry_token: retry.retryToken,
  });
}

export async function groupChatMarkRead(messageId?: string | null) {
  return invokeGroupChat<{ ok: true }>({
    type: 'group_chat_mark_read',
    ...(messageId ? { message_id: messageId } : {}),
  });
}

export async function groupChatSetMuted(muted: boolean) {
  return invokeGroupChat<{ ok: true; muted: boolean }>({
    type: 'group_chat_preferences',
    muted,
  });
}

export async function groupChatSetReaction(messageId: string, reaction: string | null) {
  const result = await invokeGroupChat<{ ok: true; reactions: GroupChatReactionSummary[] }>({
    type: 'group_chat_reaction_set',
    message_id: messageId,
    reaction,
  });
  const reactions = parseGroupMessengerReactionList(result.reactions);
  if (!reactions) return invalidGroupChatMessageResponse();
  return { ...result, reactions };
}

export async function groupChatDeleteMessage(messageId: string) {
  const result = await invokeGroupChat<{ ok: true; message: GroupChatMessage }>({
    type: 'group_chat_delete',
    message_id: messageId,
  });
  return { ...result, message: requireGroupChatMessage(result.message) };
}

function normalizeGroupChatPermissionActorId(value?: string | null) {
  const raw = String(value ?? '').trim();
  const withoutPrefix = raw.replace(/^fc:/i, '');
  const phone = withoutPrefix.replace(/[^0-9]/g, '');
  return phone ? `fc:${phone}` : raw;
}

export async function groupChatSetMemberSendPermission(targetActorId: string, canSendMessages: boolean) {
  return invokeGroupChat<{ ok: true; member: GroupChatMember }>({
    type: 'group_chat_member_send_permission',
    target_actor_id: normalizeGroupChatPermissionActorId(targetActorId),
    can_send_messages: canSendMessages,
  });
}

export async function groupChatSetNotice(messageId: string) {
  const result = await invokeGroupChat<{ ok: true; notice: GroupChatNotice }>({
    type: 'group_chat_notice_set',
    message_id: messageId,
  });
  return {
    ...result,
    notice: {
      ...result.notice,
      message: requireGroupChatMessage(result.notice?.message),
    },
  };
}

export async function groupChatClearNotice() {
  return invokeGroupChat<{ ok: true; notice: null }>({
    type: 'group_chat_notice_clear',
  });
}
