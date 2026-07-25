import {
  classifyFcNotifyDeliveryResult,
  invokeFcNotify,
  type FcNotifyDeliveryResult,
} from './fc-notify-client';
import {
  normalizeMessengerAttachmentContent,
  parseMessengerAttachmentMetadataList,
  type MessengerAttachmentMetadata,
} from './messenger-attachment-contract';
import { ADMIN_CHAT_ID, sanitizePhone } from './messenger-participants';
import { isNotificationUuid } from './notification-target';

export type GaraminDirectConversation = {
  id: string;
  counterpartyId: string;
  counterpartyName: string | null;
};

export type GaraminDirectMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
  message_type: 'text' | 'image' | 'file';
  attachments: MessengerAttachmentMetadata[];
  file_url: string | null;
  file_name: string | null;
  file_size: number | null;
};

export type GaraminDirectAttachmentCommit = {
  batchId: string;
  replayed: boolean;
};

export type GaraminDirectMessageSendResult = {
  message: GaraminDirectMessage;
  delivery: FcNotifyDeliveryResult;
  attachmentCommit: GaraminDirectAttachmentCommit | null;
};

export type GaraminDirectBroadcastSendResult = {
  messages: GaraminDirectMessage[];
  delivery: FcNotifyDeliveryResult;
  attachmentCommit: GaraminDirectAttachmentCommit | null;
};

type DirectConversationWire = {
  id?: unknown;
  counterparty_id?: unknown;
  counterparty_name?: unknown;
};

type DirectMessageWire = {
  id?: unknown;
  conversation_id?: unknown;
  sender_id?: unknown;
  receiver_id?: unknown;
  content?: unknown;
  created_at?: unknown;
  is_read?: unknown;
  message_type?: unknown;
  attachments?: unknown;
  file_url?: unknown;
  file_name?: unknown;
  file_size?: unknown;
};

function normalizeCounterpartyId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  if (normalized === ADMIN_CHAT_ID) return ADMIN_CHAT_ID;
  return sanitizePhone(normalized);
}

function parseConversation(
  value: DirectConversationWire | null | undefined,
  expectedConversationId?: string,
): GaraminDirectConversation {
  const id = value?.id;
  const counterpartyId = normalizeCounterpartyId(value?.counterparty_id);
  if (
    !isNotificationUuid(id)
    || (expectedConversationId && id !== expectedConversationId)
    || (
      counterpartyId !== ADMIN_CHAT_ID
      && counterpartyId.length !== 11
    )
  ) {
    throw new Error('대상 대화를 확인할 수 없습니다.');
  }

  return {
    id,
    counterpartyId,
    counterpartyName:
      typeof value?.counterparty_name === 'string'
        ? value.counterparty_name.trim() || null
        : null,
  };
}

function parseMessage(
  value: DirectMessageWire,
  conversationId: string,
): GaraminDirectMessage {
  const senderId =
    typeof value.sender_id === 'string' ? value.sender_id.trim() : '';
  const receiverId =
    typeof value.receiver_id === 'string' ? value.receiver_id.trim() : '';
  const content =
    typeof value.content === 'string' ? value.content : '';
  const createdAt =
    typeof value.created_at === 'string' ? value.created_at : '';
  const messageType =
    value.message_type === 'image' || value.message_type === 'file'
      ? value.message_type
      : value.message_type === 'text'
        ? 'text'
        : null;
  const attachments = parseMessengerAttachmentMetadataList(
    value.attachments,
  );
  const fileUrl =
    typeof value.file_url === 'string' && value.file_url.trim()
      ? value.file_url.trim()
      : null;
  const fileName =
    typeof value.file_name === 'string' && value.file_name.trim()
      ? value.file_name.trim()
      : null;
  const fileSize =
    typeof value.file_size === 'number'
    && Number.isSafeInteger(value.file_size)
    && value.file_size >= 0
      ? value.file_size
      : null;

  if (
    !isNotificationUuid(value.id)
    || value.conversation_id !== conversationId
    || !senderId
    || !receiverId
    || content.length > 4_000
    || (!content && attachments.length === 0 && !fileUrl)
    || !Number.isFinite(Date.parse(createdAt))
    || typeof value.is_read !== 'boolean'
    || !messageType
    || (
      attachments.length > 0
      && (fileUrl !== null || fileName !== null || fileSize !== null)
    )
  ) {
    throw new Error('대화 응답 형식이 올바르지 않습니다.');
  }

  return {
    id: value.id,
    conversation_id: conversationId,
    sender_id: senderId,
    receiver_id: receiverId,
    content,
    created_at: createdAt,
    is_read: value.is_read,
    message_type: messageType,
    attachments,
    file_url: fileUrl,
    file_name: fileName,
    file_size: fileSize,
  };
}

function parseAttachmentCommit(value: unknown) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('대화 응답 형식이 올바르지 않습니다.');
  }
  const commit = value as Record<string, unknown>;
  if (
    !isNotificationUuid(commit.batchId)
    || typeof commit.replayed !== 'boolean'
  ) {
    throw new Error('대화 응답 형식이 올바르지 않습니다.');
  }
  return {
    batchId: commit.batchId.toLowerCase(),
    replayed: commit.replayed,
  };
}

function normalizeAttachmentSendFields(input: {
  attachmentIntentIds?: readonly string[];
  deliveryKey?: string;
  payloadFingerprint?: string;
}) {
  const intentIds = input.attachmentIntentIds;
  const hasAttachmentFields =
    intentIds !== undefined
    || input.deliveryKey !== undefined
    || input.payloadFingerprint !== undefined;
  if (!hasAttachmentFields) return null;
  const deliveryKey = String(input.deliveryKey ?? '').trim().toLowerCase();
  const payloadFingerprint = String(
    input.payloadFingerprint ?? '',
  ).trim().toLowerCase();
  if (
    !Array.isArray(intentIds)
    || intentIds.length < 1
    || intentIds.length > 10
    || !intentIds.every(isNotificationUuid)
    || new Set(intentIds.map((id) => id.toLowerCase())).size !== intentIds.length
    || !isNotificationUuid(deliveryKey)
    || !/^[0-9a-f]{64}$/.test(payloadFingerprint)
  ) {
    throw new Error('첨부 파일 전송 정보를 확인해 주세요.');
  }
  return {
    attachmentIntentIds: intentIds.map((id) => id.toLowerCase()),
    deliveryKey,
    payloadFingerprint,
  };
}

async function invokeDirectMessageAction<T>(
  body: Record<string, unknown> & { type: string },
): Promise<T> {
  const { data, error } = await invokeFcNotify<T & {
    ok?: boolean;
    message?: unknown;
  }>(body);
  if (error || !data || data.ok !== true) {
    const message =
      data && typeof data.message === 'string'
        ? data.message
        : '대화 요청을 처리하지 못했습니다.';
    throw error ?? new Error(message);
  }
  return data;
}

export async function resolveGaraminDirectConversation(
  input:
    | { conversationId: string; targetId?: never }
    | { conversationId?: never; targetId: string | null },
): Promise<GaraminDirectConversation> {
  if (
    'conversationId' in input
    && !isNotificationUuid(input.conversationId)
  ) {
    throw new Error('대상 대화를 확인할 수 없습니다.');
  }

  const data = await invokeDirectMessageAction<{
    ok: true;
    conversation?: DirectConversationWire;
  }>({
    type: 'resolve_garamin_direct_conversation',
    ...('conversationId' in input
      ? { conversation_id: input.conversationId }
      : { target_id: input.targetId }),
  });

  return parseConversation(
    data.conversation,
    'conversationId' in input ? input.conversationId : undefined,
  );
}

export async function fetchGaraminDirectMessages(
  conversationId: string,
): Promise<{
  conversation: GaraminDirectConversation;
  messages: GaraminDirectMessage[];
}> {
  if (!isNotificationUuid(conversationId)) {
    throw new Error('대상 대화를 확인할 수 없습니다.');
  }
  const data = await invokeDirectMessageAction<{
    ok: true;
    conversation?: DirectConversationWire;
    messages?: DirectMessageWire[];
  }>({
    type: 'direct_message_list',
    conversation_id: conversationId,
  });
  const conversation = parseConversation(
    data.conversation,
    conversationId,
  );
  if (!Array.isArray(data.messages)) {
    throw new Error('대화 응답 형식이 올바르지 않습니다.');
  }
  const messages = data.messages.map((message) =>
    parseMessage(message, conversationId)
  );
  for (let index = 1; index < messages.length; index += 1) {
    if (
      Date.parse(messages[index - 1].created_at)
      > Date.parse(messages[index].created_at)
    ) {
      throw new Error('대화 응답 순서가 올바르지 않습니다.');
    }
  }
  return { conversation, messages };
}

export async function sendGaraminDirectMessage(input: {
  conversationId: string;
  clientMessageId: string;
  content: string;
  attachmentIntentIds?: readonly string[];
  deliveryKey?: string;
  payloadFingerprint?: string;
}): Promise<GaraminDirectMessageSendResult> {
  const content = normalizeMessengerAttachmentContent(input.content);
  const attachmentFields = normalizeAttachmentSendFields(input);
  if (
    !isNotificationUuid(input.conversationId)
    || !isNotificationUuid(input.clientMessageId)
    || (!content && !attachmentFields)
    || content.length > 4_000
  ) {
    throw new Error('메시지 내용을 확인해 주세요.');
  }
  const transport = await invokeFcNotify<{
    ok?: boolean;
    message?: unknown;
    delivery?: unknown;
  }>({
    type: 'direct_message_send',
    conversation_id: input.conversationId,
    client_message_id: input.clientMessageId.toLowerCase(),
    content,
    ...(attachmentFields
      ? {
          attachment_intent_ids: attachmentFields.attachmentIntentIds,
          delivery_key: attachmentFields.deliveryKey,
          payload_fingerprint: attachmentFields.payloadFingerprint,
        }
      : {}),
  });
  const data = transport.data;
  if (transport.error || !data || data.ok !== true) {
    const message =
      data && typeof data.message === 'string'
        ? data.message
        : '대화 요청을 처리하지 못했습니다.';
    throw transport.error ?? new Error(message);
  }
  if (!data.message || typeof data.message !== 'object' || Array.isArray(data.message)) {
    throw new Error('대화 응답 형식이 올바르지 않습니다.');
  }
  const message = parseMessage(
    data.message as DirectMessageWire,
    input.conversationId,
  );
  if (message.id !== input.clientMessageId.toLowerCase()) {
    throw new Error('대화 응답 식별자가 요청과 일치하지 않습니다.');
  }
  const attachmentCommit = parseAttachmentCommit(
    (data as { attachmentCommit?: unknown }).attachmentCommit,
  );
  if (
    attachmentFields
    && (
      !attachmentCommit
      || message.message_type !== 'file'
      || message.attachments.length
        !== attachmentFields.attachmentIntentIds.length
    )
  ) {
    throw new Error('서버가 첨부파일 저장을 확인하지 못했습니다.');
  }
  return {
    message,
    delivery: classifyFcNotifyDeliveryResult(transport),
    attachmentCommit,
  };
}

export async function sendGaraminDirectBroadcast(input: {
  conversationIds: readonly string[];
  clientMessageIds: readonly string[];
  content: string;
  attachmentIntentIds?: readonly string[];
  deliveryKey?: string;
  payloadFingerprint?: string;
}): Promise<GaraminDirectBroadcastSendResult> {
  const conversationIds = input.conversationIds.map((id) =>
    String(id).trim().toLowerCase()
  );
  const clientMessageIds = input.clientMessageIds.map((id) =>
    String(id).trim().toLowerCase()
  );
  const content = normalizeMessengerAttachmentContent(input.content);
  const attachmentFields = normalizeAttachmentSendFields(input);
  if (
    conversationIds.length < 1
    || conversationIds.length > 200
    || conversationIds.length !== clientMessageIds.length
    || new Set(conversationIds).size !== conversationIds.length
    || !conversationIds.every(isNotificationUuid)
    || !clientMessageIds.every(isNotificationUuid)
    || new Set(clientMessageIds).size !== clientMessageIds.length
    || (!content && !attachmentFields)
    || content.length > 4_000
  ) {
    throw new Error('공지 메시지 전송 정보를 확인해 주세요.');
  }

  const transport = await invokeFcNotify<{
    ok?: boolean;
    messages?: unknown;
    attachmentCommit?: unknown;
    delivery?: unknown;
    message?: unknown;
  }>({
    type: 'direct_message_broadcast_send',
    conversation_ids: conversationIds,
    client_message_ids: clientMessageIds,
    content,
    ...(attachmentFields
      ? {
          attachment_intent_ids: attachmentFields.attachmentIntentIds,
          delivery_key: attachmentFields.deliveryKey,
          payload_fingerprint: attachmentFields.payloadFingerprint,
        }
      : {}),
  });
  const data = transport.data;
  if (transport.error || !data || data.ok !== true) {
    const message =
      data && typeof data.message === 'string'
        ? data.message
        : '공지 메시지를 전송하지 못했습니다.';
    throw transport.error ?? new Error(message);
  }
  if (
    !Array.isArray(data.messages)
    || data.messages.length !== conversationIds.length
  ) {
    throw new Error('대화 응답 형식이 올바르지 않습니다.');
  }
  const messages = data.messages.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('대화 응답 형식이 올바르지 않습니다.');
    }
    const message = parseMessage(
      raw as DirectMessageWire,
      conversationIds[index],
    );
    if (message.id !== clientMessageIds[index]) {
      throw new Error('대화 응답 식별자가 요청과 일치하지 않습니다.');
    }
    return message;
  });
  const attachmentCommit = parseAttachmentCommit(data.attachmentCommit);
  if (
    attachmentFields
    && (
      !attachmentCommit
      || messages.some((message) =>
        message.message_type !== 'file'
        || message.attachments.length
          !== attachmentFields.attachmentIntentIds.length
      )
    )
  ) {
    throw new Error('서버가 첨부파일 저장을 확인하지 못했습니다.');
  }
  return {
    messages,
    delivery: classifyFcNotifyDeliveryResult(transport),
    attachmentCommit,
  };
}

export async function markGaraminDirectMessagesRead(
  conversationId: string,
): Promise<number> {
  if (!isNotificationUuid(conversationId)) {
    throw new Error('대상 대화를 확인할 수 없습니다.');
  }
  const data = await invokeDirectMessageAction<{
    ok: true;
    updated?: unknown;
  }>({
    type: 'direct_message_mark_read',
    conversation_id: conversationId,
  });
  if (
    typeof data.updated !== 'number'
    || !Number.isSafeInteger(data.updated)
    || data.updated < 0
  ) {
    throw new Error('읽음 처리 응답 형식이 올바르지 않습니다.');
  }
  return data.updated;
}

export async function deleteGaraminDirectMessage(input: {
  conversationId: string;
  messageId: string;
}): Promise<void> {
  if (
    !isNotificationUuid(input.conversationId)
    || !isNotificationUuid(input.messageId)
  ) {
    throw new Error('삭제할 메시지를 확인할 수 없습니다.');
  }
  const data = await invokeDirectMessageAction<{
    ok: true;
    deleted?: unknown;
  }>({
    type: 'direct_message_delete',
    conversation_id: input.conversationId,
    message_id: input.messageId,
  });
  if (data.deleted !== true) {
    throw new Error('메시지를 삭제하지 못했습니다.');
  }
}
