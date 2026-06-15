import { getStoredAppSessionToken } from './request-board-api';
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

type GroupChatFunctionResponse<T> = GroupChatSuccess & T;

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
}) {
  const messageType = input.messageType ?? 'text';
  return {
    type: 'group_chat_send' as const,
    content: input.content,
    message_type: messageType,
    ...(input.fileUrl ? { file_url: input.fileUrl } : {}),
    ...(input.fileName ? { file_name: input.fileName } : {}),
    ...(typeof input.fileSize === 'number' ? { file_size: input.fileSize } : {}),
    ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {}),
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

export function buildGroupChatMemberSendPermissionBody(targetActorId: string, canSendMessages: boolean) {
  return {
    type: 'group_chat_member_send_permission' as const,
    target_actor_id: targetActorId,
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

async function invokeGroupChat<T>(body: Record<string, unknown>): Promise<T> {
  const appSessionToken = await getStoredAppSessionToken();
  if (!appSessionToken) {
    throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
  }

  const { data, error } = await supabase.functions.invoke<GroupChatFunctionResponse<T>>(GROUP_CHAT_FUNCTION, {
    body,
    headers: {
      'x-app-session-token': appSessionToken,
    },
  });

  if (error) throw error;
  if (!data?.ok) {
    throw new Error(data?.message ?? '단톡방 요청을 처리하지 못했습니다.');
  }

  return data as T;
}

export async function groupChatBootstrap(limit = 50) {
  return invokeGroupChat<GroupChatBootstrapResponse>(buildGroupChatBootstrapBody(limit));
}

export async function groupChatSend(input: Parameters<typeof buildGroupChatSendBody>[0]) {
  return invokeGroupChat<{ message: GroupChatMessage }>(buildGroupChatSendBody(input));
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
  return invokeGroupChat<{ message: GroupChatMessage }>(buildGroupChatDeleteBody(messageId));
}

export async function groupChatSetMemberSendPermission(targetActorId: string, canSendMessages: boolean) {
  return invokeGroupChat<{ member: GroupChatMember }>(
    buildGroupChatMemberSendPermissionBody(targetActorId, canSendMessages),
  );
}

export async function groupChatSetNotice(messageId: string) {
  return invokeGroupChat<{ notice: GroupChatNotice }>(buildGroupChatNoticeSetBody(messageId));
}

export async function groupChatClearNotice() {
  return invokeGroupChat<{ notice: null }>(buildGroupChatNoticeClearBody());
}
