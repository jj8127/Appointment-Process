import { safeDecodeFileName } from '@/lib/validation';

export type GroupChatDisplayRole = 'fc' | 'manager' | 'admin' | string;
export type GroupChatMemberStatusTone = 'complete' | 'partial' | 'pending' | 'active';

type GroupChatActorLike = {
  role?: GroupChatDisplayRole | null;
};

type GroupChatMessageLike = {
  deleted_at?: string | null;
  message_type?: 'text' | 'image' | 'file' | string | null;
  file_name?: string | null;
  content?: string | null;
};

type GroupChatMemberLike = {
  role?: GroupChatDisplayRole | null;
  appointment_label?: string | null;
};

const GROUP_CHAT_ROLE_LABELS: Record<string, string> = {
  fc: 'FC',
  manager: '본부장',
  admin: '총무',
};

export function getGroupChatRoleLabel(role?: GroupChatDisplayRole | null) {
  return role ? GROUP_CHAT_ROLE_LABELS[role] ?? '사용자' : '사용자';
}

export function isStaffGroupChatActor(actor?: GroupChatActorLike | null) {
  return actor?.role === 'manager' || actor?.role === 'admin';
}

export function resolveGroupChatSendPermission(
  actor: GroupChatActorLike | null | undefined,
  canSendMessages?: boolean | null,
) {
  return isStaffGroupChatActor(actor) || canSendMessages === true;
}

export function normalizeGroupChatMemberSearch(value?: string | null) {
  return String(value ?? '').replace(/\s+/g, '').trim().toLowerCase();
}

export function formatGroupChatTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

export function getGroupChatMemberStatusTone(member: GroupChatMemberLike): GroupChatMemberStatusTone {
  if (member.role !== 'fc') return 'active';
  if (member.appointment_label === '위촉 완료') return 'complete';
  if (member.appointment_label === '위촉 대기') return 'pending';
  return 'partial';
}

export function getGroupChatReplyLabel(message?: GroupChatMessageLike | null) {
  if (!message) return '';
  if (message.deleted_at) return '삭제된 메시지';
  if (message.message_type === 'image') return '사진';
  if (message.message_type === 'file') return safeDecodeFileName(message.file_name) || '파일';
  return message.content ?? '';
}

export function getGroupChatMessageCopyText(message?: GroupChatMessageLike | null) {
  if (!message || message.deleted_at) return '';
  if (message.message_type === 'file') return safeDecodeFileName(message.file_name) || message.content || '';
  return message.content ?? '';
}
