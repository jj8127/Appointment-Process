import { GroupChatRequestError } from '@/lib/group-chat-error';

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
};

export type GroupChatSendWarning = {
  code: 'notification_delivery_partial';
  message: string;
};

export type GroupChatSendResponse = {
  ok: true;
  message: GroupChatMessage;
  notification: GroupChatNotificationSummary;
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

async function invokeGroupChat<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/group-chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    throw new GroupChatRequestError(payload?.message ?? payload?.error ?? '단톡방 요청을 처리하지 못했습니다.', {
      code: typeof payload?.code === 'string' ? payload.code : undefined,
      status: response.status,
      raw: payload,
    });
  }

  return payload as T;
}

export async function groupChatBootstrap(limit = 80) {
  return invokeGroupChat<GroupChatBootstrapResponse>({
    type: 'group_chat_bootstrap',
    limit,
  });
}

export async function groupChatSend(input: {
  content: string;
  messageType?: GroupChatMessageType;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  replyToMessageId?: string | null;
}) {
  return invokeGroupChat<GroupChatSendResponse>({
    type: 'group_chat_send',
    content: input.content,
    message_type: input.messageType ?? 'text',
    ...(input.fileUrl ? { file_url: input.fileUrl } : {}),
    ...(input.fileName ? { file_name: input.fileName } : {}),
    ...(typeof input.fileSize === 'number' ? { file_size: input.fileSize } : {}),
    ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
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
  return invokeGroupChat<{ ok: true; reactions: GroupChatReactionSummary[] }>({
    type: 'group_chat_reaction_set',
    message_id: messageId,
    reaction,
  });
}

export async function groupChatDeleteMessage(messageId: string) {
  return invokeGroupChat<{ ok: true; message: GroupChatMessage }>({
    type: 'group_chat_delete',
    message_id: messageId,
  });
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
  return invokeGroupChat<{ ok: true; notice: GroupChatNotice }>({
    type: 'group_chat_notice_set',
    message_id: messageId,
  });
}

export async function groupChatClearNotice() {
  return invokeGroupChat<{ ok: true; notice: null }>({
    type: 'group_chat_notice_clear',
  });
}
