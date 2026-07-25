import { getStoredAppSessionToken } from './request-board-api';
import { GroupChatRequestError } from './group-chat-error';
import {
  normalizeMessengerAttachmentContent,
  parseMessengerAttachmentMetadataList,
  type MessengerAttachmentMetadata,
} from './messenger-attachment-contract';
import { isNotificationUuid } from './notification-target';
import { supabase } from './supabase';

export type GroupChatMessageType = 'text' | 'image' | 'file';
export type GroupChatRole = 'fc' | 'manager' | 'admin';

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

export type GroupChatNotice = {
  room_id: string;
  message_id: string;
  created_by_actor_id: string;
  created_by_role: GroupChatRole;
  created_at: string;
  updated_at: string;
  message: GroupChatMessage;
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
  attachments: MessengerAttachmentMetadata[];
  created_at: string;
  unread_count: number;
  reply_to_message_id: string | null;
  reply_to_sender_name: string | null;
  reply_to_content: string | null;
  deleted_at: string | null;
  deleted_by_actor_id: string | null;
  reactions: GroupChatReactionSummary[];
  send_status?: 'sending' | 'failed';
};

export type GroupChatNotificationSummary = {
  ok: boolean;
  status: 'skipped' | 'inbox_only' | 'provider_accepted' | 'partial';
  recipient_count: number;
  notification_count: number;
  push_token_count: number;
  push_accepted_count: number;
  push_rejected_count: number;
  delivery: GroupChatNotificationDelivery;
};

export type GroupChatNotificationDelivery = {
  notificationStored: boolean;
  pushStatus:
    | 'accepted'
    | 'no_registered_device'
    | 'provider_rejected'
    | 'not_attempted';
  retryable: boolean;
  notificationIds?: string[];
};

export type GroupChatNotificationRetry = {
  messageId: string;
  retryToken: string;
};

export type GroupChatSendWarning = {
  code: 'notification_delivery_partial';
  message: string;
};

export type GroupChatSendResponse = {
  message: GroupChatMessage;
  read_state?: { updated: boolean };
  notification: GroupChatNotificationSummary;
  delivery: GroupChatNotificationDelivery;
  notificationRetry: GroupChatNotificationRetry | null;
  attachmentCommit?: {
    batchId: string;
    replayed: boolean;
  } | null;
  warning?: GroupChatSendWarning | null;
};

export type GroupChatNotificationRetryResponse = {
  notification: GroupChatNotificationSummary;
  delivery: GroupChatNotificationDelivery;
  notificationRetry: GroupChatNotificationRetry | null;
  warning?: GroupChatSendWarning | null;
};

export type GroupChatBootstrapResponse = {
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

type GroupChatSuccess = {
  ok: true;
  message?: string;
};

type GroupChatFailure = {
  ok: false;
  code?: string;
  message?: string;
  error?: string;
};

type GroupChatFunctionResponse<T> = (GroupChatSuccess & T) | GroupChatFailure;

export const GROUP_CHAT_FUNCTION = 'group-chat';

export function buildGroupChatBootstrapBody(limit = 50) {
  return {
    type: 'group_chat_bootstrap' as const,
    limit,
  };
}

export function buildGroupChatSendBody(input: {
  content: string;
  messageType?: GroupChatMessageType;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  replyToMessageId?: string | null;
  attachmentIntentIds?: readonly string[];
  deliveryKey?: string;
  payloadFingerprint?: string;
}) {
  const messageType = input.messageType ?? 'text';
  const hasAttachmentFields =
    input.attachmentIntentIds !== undefined
    || input.deliveryKey !== undefined
    || input.payloadFingerprint !== undefined;
  const attachmentIntentIds = input.attachmentIntentIds?.map((id) =>
    String(id).trim().toLowerCase()
  );
  const deliveryKey = String(input.deliveryKey ?? '').trim().toLowerCase();
  const payloadFingerprint = String(
    input.payloadFingerprint ?? '',
  ).trim().toLowerCase();
  if (
    hasAttachmentFields
    && (
      !attachmentIntentIds
      || attachmentIntentIds.length < 1
      || attachmentIntentIds.length > 10
      || !attachmentIntentIds.every(isNotificationUuid)
      || new Set(attachmentIntentIds).size !== attachmentIntentIds.length
      || !isNotificationUuid(deliveryKey)
      || !/^[0-9a-f]{64}$/.test(payloadFingerprint)
      || Boolean(input.fileUrl || input.fileName || input.fileSize)
    )
  ) {
    throw new GroupChatRequestError('첨부 파일 전송 정보를 확인해 주세요.', {
      code: 'invalid_attachment_metadata',
    });
  }
  const content = normalizeMessengerAttachmentContent(input.content);
  if ((!content && !hasAttachmentFields) || content.length > 4_000) {
    throw new GroupChatRequestError('메시지 내용을 확인해 주세요.', {
      code: 'invalid_message_content',
    });
  }
  return {
    type: 'group_chat_send' as const,
    content,
    message_type: messageType,
    ...(input.fileUrl ? { file_url: input.fileUrl } : {}),
    ...(input.fileName ? { file_name: input.fileName } : {}),
    ...(typeof input.fileSize === 'number' ? { file_size: input.fileSize } : {}),
    ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
    ...(attachmentIntentIds
      ? {
          attachment_intent_ids: attachmentIntentIds,
          delivery_key: deliveryKey,
          payload_fingerprint: payloadFingerprint,
        }
      : {}),
  };
}

export function parseGroupChatNotificationRetry(
  value: unknown,
): GroupChatNotificationRetry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const retry = value as Record<string, unknown>;
  if (
    Object.keys(retry).length !== 2
    || !isNotificationUuid(retry.messageId)
    || typeof retry.retryToken !== 'string'
    || retry.retryToken.length < 1
    || retry.retryToken.length > 8_192
    || retry.retryToken.trim() !== retry.retryToken
  ) {
    return null;
  }
  return {
    messageId: retry.messageId,
    retryToken: retry.retryToken,
  };
}

export function buildGroupChatNotificationRetryBody(
  input: GroupChatNotificationRetry,
) {
  const retry = parseGroupChatNotificationRetry(input);
  if (!retry) {
    throw new GroupChatRequestError('알림 재시도 정보가 올바르지 않습니다.', {
      code: 'invalid_notification_retry',
    });
  }
  return {
    type: 'group_chat_notification_retry' as const,
    message_id: retry.messageId,
    retry_token: retry.retryToken,
  };
}

export function buildGroupChatMarkReadBody(messageId?: string | null) {
  return {
    type: 'group_chat_mark_read' as const,
    ...(messageId ? { message_id: messageId } : {}),
  };
}

export function buildGroupChatPreferencesBody(muted: boolean) {
  return {
    type: 'group_chat_preferences' as const,
    muted,
  };
}

export function buildGroupChatReactionBody(messageId: string, reaction: string | null) {
  return {
    type: 'group_chat_reaction_set' as const,
    message_id: messageId,
    reaction,
  };
}

export function buildGroupChatDeleteBody(messageId: string) {
  return {
    type: 'group_chat_delete' as const,
    message_id: messageId,
  };
}

export function normalizeGroupChatPermissionActorId(value?: string | null) {
  const raw = String(value ?? '').trim();
  const withoutPrefix = raw.replace(/^fc:/i, '');
  const phone = withoutPrefix.replace(/[^0-9]/g, '');
  return phone ? `fc:${phone}` : raw;
}

export function buildGroupChatMemberSendPermissionBody(targetActorId: string, canSendMessages: boolean) {
  return {
    type: 'group_chat_member_send_permission' as const,
    target_actor_id: normalizeGroupChatPermissionActorId(targetActorId),
    can_send_messages: canSendMessages,
  };
}

export function buildGroupChatNoticeSetBody(messageId: string) {
  return {
    type: 'group_chat_notice_set' as const,
    message_id: messageId,
  };
}

export function buildGroupChatNoticeClearBody() {
  return {
    type: 'group_chat_notice_clear' as const,
  };
}

function readGroupChatErrorString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readGroupChatErrorStatus(error: unknown) {
  const context = error && typeof error === 'object'
    ? (error as { context?: unknown }).context
    : null;
  return context && typeof context === 'object' && typeof (context as { status?: unknown }).status === 'number'
    ? (context as { status: number }).status
    : undefined;
}

async function readGroupChatFunctionErrorPayload(error: unknown) {
  const context = error && typeof error === 'object'
    ? (error as { context?: unknown }).context
    : null;
  if (!context || typeof context !== 'object') return null;

  const response = context as {
    clone?: () => { json?: () => Promise<unknown> };
    json?: () => Promise<unknown>;
  };
  const reader = typeof response.clone === 'function' ? response.clone() : response;
  if (typeof reader.json !== 'function') return null;

  try {
    const payload = await reader.json();
    return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

async function invokeGroupChat<T>(body: Record<string, unknown>): Promise<T> {
  const appSessionToken = await getStoredAppSessionToken();
  if (!appSessionToken) {
    throw new GroupChatRequestError('단톡방 세션이 없습니다. 다시 로그인해주세요.', {
      code: 'missing_app_session',
      status: 401,
    });
  }

  const { data, error } = await supabase.functions.invoke<GroupChatFunctionResponse<T>>(GROUP_CHAT_FUNCTION, {
    body,
    headers: {
      'x-app-session-token': appSessionToken,
    },
  });

  if (error) {
    const payload = await readGroupChatFunctionErrorPayload(error);
    throw new GroupChatRequestError(
      readGroupChatErrorString(payload?.message)
        ?? readGroupChatErrorString(payload?.error)
        ?? (error instanceof Error ? error.message : '단톡방 요청을 처리하지 못했습니다.'),
      {
        code: readGroupChatErrorString(payload?.code),
        status: readGroupChatErrorStatus(error),
        raw: error,
      },
    );
  }
  if (!data?.ok) {
    throw new GroupChatRequestError(data?.message ?? data?.error ?? '단톡방 요청을 처리하지 못했습니다.', {
      code: data?.code,
      raw: data,
    });
  }

  return data as T;
}

function hydrateGroupChatMessage(
  message: GroupChatMessage,
): GroupChatMessage {
  return {
    ...message,
    attachments: parseMessengerAttachmentMetadataList(
      (message as GroupChatMessage & { attachments?: unknown }).attachments,
    ),
  };
}

function hydrateGroupChatNotice(
  notice: GroupChatNotice | null,
): GroupChatNotice | null {
  if (!notice) return null;
  return {
    ...notice,
    message: hydrateGroupChatMessage(notice.message),
  };
}

function parseGroupChatAttachmentCommit(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const commit = value as Record<string, unknown>;
  if (
    !isNotificationUuid(commit.batchId)
    || typeof commit.replayed !== 'boolean'
  ) {
    return null;
  }
  return {
    batchId: commit.batchId.toLowerCase(),
    replayed: commit.replayed,
  };
}

export async function groupChatBootstrap(limit = 50) {
  const result = await invokeGroupChat<GroupChatBootstrapResponse>(
    buildGroupChatBootstrapBody(limit),
  );
  return {
    ...result,
    last_message: result.last_message
      ? hydrateGroupChatMessage(result.last_message)
      : null,
    messages: result.messages.map(hydrateGroupChatMessage),
    notice: hydrateGroupChatNotice(result.notice),
  };
}

export async function groupChatSend(input: Parameters<typeof buildGroupChatSendBody>[0]) {
  const body = buildGroupChatSendBody(input);
  const result = await invokeGroupChat<GroupChatSendResponse>(
    body,
  );
  const message = hydrateGroupChatMessage(result.message);
  const expectedAttachmentCount =
    'attachment_intent_ids' in body
    && Array.isArray(body.attachment_intent_ids)
      ? body.attachment_intent_ids.length
      : 0;
  const attachmentCommit = parseGroupChatAttachmentCommit(
    result.attachmentCommit,
  );
  if (
    expectedAttachmentCount > 0
    && (
      !attachmentCommit
      || message.message_type !== 'file'
      || message.attachments.length !== expectedAttachmentCount
    )
  ) {
    throw new GroupChatRequestError(
      '서버가 첨부파일 저장을 확인하지 못했습니다.',
      { code: 'invalid_attachment_commit_response' },
    );
  }
  return {
    ...result,
    message,
    ...(expectedAttachmentCount > 0 ? { attachmentCommit } : {}),
  };
}

export function hasGroupChatPostCommitWarning(
  result: {
    delivery?: GroupChatNotificationDelivery | null;
    read_state?: unknown;
    notification?: unknown;
    warning?: unknown;
  },
) {
  return result.delivery?.notificationStored === false;
}

export function getGroupChatNotificationRetry(
  result: {
    delivery?: GroupChatNotificationDelivery | null;
    notificationRetry?: unknown;
  },
) {
  if (result.delivery?.notificationStored !== false) return null;
  return parseGroupChatNotificationRetry(result.notificationRetry);
}

export async function groupChatRetryNotification(
  input: GroupChatNotificationRetry,
) {
  return invokeGroupChat<GroupChatNotificationRetryResponse>(
    buildGroupChatNotificationRetryBody(input),
  );
}

export async function groupChatMarkRead(messageId?: string | null) {
  return invokeGroupChat<Record<string, never>>(buildGroupChatMarkReadBody(messageId));
}

export async function groupChatSetMuted(muted: boolean) {
  return invokeGroupChat<{ muted: boolean }>(buildGroupChatPreferencesBody(muted));
}

export async function groupChatSetReaction(messageId: string, reaction: string | null) {
  return invokeGroupChat<{ reactions: GroupChatReactionSummary[] }>(
    buildGroupChatReactionBody(messageId, reaction),
  );
}

export async function groupChatDeleteMessage(messageId: string) {
  const result = await invokeGroupChat<{ message: GroupChatMessage }>(
    buildGroupChatDeleteBody(messageId),
  );
  return {
    ...result,
    message: hydrateGroupChatMessage(result.message),
  };
}

export async function groupChatSetMemberSendPermission(targetActorId: string, canSendMessages: boolean) {
  return invokeGroupChat<{ member: GroupChatMember }>(
    buildGroupChatMemberSendPermissionBody(targetActorId, canSendMessages),
  );
}

export async function groupChatSetNotice(messageId: string) {
  const result = await invokeGroupChat<{ notice: GroupChatNotice }>(
    buildGroupChatNoticeSetBody(messageId),
  );
  return {
    ...result,
    notice: hydrateGroupChatNotice(result.notice) as GroupChatNotice,
  };
}

export async function groupChatClearNotice() {
  return invokeGroupChat<{ notice: null }>(buildGroupChatNoticeClearBody());
}
