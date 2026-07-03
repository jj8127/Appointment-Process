export type GroupChatRole = 'fc' | 'manager' | 'admin';
export type GroupChatMessageType = 'text' | 'image' | 'file';

type BaseMemberInput = {
  phone?: string | null;
  name?: string | null;
};

export type GroupChatMemberInput =
  | (BaseMemberInput & {
    kind: 'fc';
    signup_completed?: boolean | null;
    affiliation?: string | null;
    is_manager_referral_shadow?: boolean | null;
    life_commission_completed?: boolean | null;
    nonlife_commission_completed?: boolean | null;
    appointment_date_life?: string | null;
    appointment_date_nonlife?: string | null;
  })
  | (BaseMemberInput & {
      kind: 'manager';
      active?: boolean | null;
    })
  | (BaseMemberInput & {
      kind: 'admin';
      active?: boolean | null;
      staff_type?: string | null;
    });

export type GroupChatActor = {
  id: string;
  role: GroupChatRole;
  phone: string;
  name: string | null;
};

export type GroupChatMessageLike = {
  id?: string | null;
  sender_actor_id?: string | null;
  created_at?: string | null;
};

export type GroupChatReadStateLike = {
  actor_id?: string | null;
  last_read_at?: string | null;
};

export type GroupChatUnreadMemberLike = {
  actor_id?: string | null;
};

export type GroupChatReactionLike = {
  actor_id?: string | null;
  reaction?: string | null;
};

export type GroupChatSendPermissionLike = {
  actor_id?: string | null;
  can_send_messages?: boolean | null;
};

export const GROUP_CHAT_ROOM_SLUG = 'garampa-default';
export const GROUP_CHAT_ROOM_TITLE = '가람PA 단톡방';
export const GROUP_CHAT_NOTIFICATION_CATEGORY = 'group_chat_message';
export const GROUP_CHAT_TARGET_URL = '/group-chat';

export const sanitizeGroupChatPhone = (value?: string | null) => String(value ?? '').replace(/[^0-9]/g, '');
export const normalizeGroupChatText = (value?: string | null) => String(value ?? '').replace(/\s+/g, ' ').trim();
export function normalizeFcGroupChatActorId(value?: string | null) {
  const raw = normalizeGroupChatText(value);
  const withoutPrefix = raw.replace(/^fc:/i, '');
  const phone = sanitizeGroupChatPhone(withoutPrefix);
  return phone ? `fc:${phone}` : '';
}
export const normalizeGroupChatMessageContent = (value?: string | null) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();

export function isRequestBoardDesignerAffiliation(value?: string | null) {
  return normalizeGroupChatText(value).replace(/\s+/g, '').includes('설계매니저');
}

export function isEligibleGroupChatMember(member: GroupChatMemberInput) {
  const phone = sanitizeGroupChatPhone(member.phone);
  if (!phone) return false;

  if (member.kind === 'fc') {
    if (member.signup_completed !== true) return false;
    if (member.is_manager_referral_shadow === true) return false;
    return !isRequestBoardDesignerAffiliation(member.affiliation);
  }

  if (member.kind === 'admin') {
    return member.active === true;
  }

  return member.active === true;
}

export function buildGroupChatAppointmentLabel(member: Extract<GroupChatMemberInput, { kind: 'fc' }>) {
  const lifeCompleted = Boolean(member.life_commission_completed || normalizeGroupChatText(member.appointment_date_life));
  const nonlifeCompleted = Boolean(member.nonlife_commission_completed || normalizeGroupChatText(member.appointment_date_nonlife));

  if (lifeCompleted && nonlifeCompleted) return '위촉 완료';
  if (lifeCompleted) return '생명 완료';
  if (nonlifeCompleted) return '손해 완료';
  return '위촉 대기';
}

export function buildGroupChatActor(input: {
  role?: GroupChatRole | null;
  phone?: string | null;
  name?: string | null;
}): GroupChatActor | null {
  const role = input.role ?? null;
  if (role !== 'fc' && role !== 'manager' && role !== 'admin') return null;

  const phone = sanitizeGroupChatPhone(input.phone);
  if (!phone) return null;

  return {
    id: `${role}:${phone}`,
    role,
    phone,
    name: normalizeGroupChatText(input.name) || null,
  };
}

export function canGroupChatActorSendMessages(input: {
  actor?: GroupChatActor | null;
  permissions?: GroupChatSendPermissionLike[] | null;
}) {
  const actor = input.actor ?? null;
  if (!actor?.id) return false;
  if (actor.role !== 'fc') return true;

  const actorId = normalizeGroupChatText(actor.id);
  return (input.permissions ?? []).some((row) =>
    normalizeGroupChatText(row.actor_id) === actorId && row.can_send_messages === true,
  );
}

export function computeGroupChatUnreadCount(input: {
  viewerActorId?: string | null;
  lastReadAt?: string | null;
  messages: GroupChatMessageLike[];
}) {
  const viewerActorId = normalizeGroupChatText(input.viewerActorId);
  if (!viewerActorId) return 0;

  const lastReadTime = input.lastReadAt ? new Date(input.lastReadAt).getTime() : 0;

  return input.messages.reduce((count, message) => {
    const senderActorId = normalizeGroupChatText(message.sender_actor_id);
    if (!senderActorId || senderActorId === viewerActorId) return count;

    const messageTime = message.created_at ? new Date(message.created_at).getTime() : 0;
    if (!Number.isFinite(messageTime) || messageTime <= lastReadTime) return count;

    return count + 1;
  }, 0);
}

function parseGroupChatTime(value?: string | null) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

export function computeGroupChatMessageUnreadCounts(input: {
  members: GroupChatUnreadMemberLike[];
  readStates: GroupChatReadStateLike[];
  messages: GroupChatMessageLike[];
}) {
  const memberActorIds = Array.from(
    new Set(input.members.map((member) => normalizeGroupChatText(member.actor_id)).filter(Boolean)),
  );
  const readAtByActorId = new Map(
    input.readStates
      .map((row) => {
        const actorId = normalizeGroupChatText(row.actor_id);
        const readAt = parseGroupChatTime(row.last_read_at);
        return actorId ? ([actorId, readAt] as const) : null;
      })
      .filter((row): row is readonly [string, number | null] => row !== null),
  );

  return input.messages.reduce((counts, message) => {
    const messageId = normalizeGroupChatText(message.id);
    if (!messageId) return counts;

    const messageTime = parseGroupChatTime(message.created_at);
    if (messageTime === null) {
      counts.set(messageId, 0);
      return counts;
    }

    const senderActorId = normalizeGroupChatText(message.sender_actor_id);
    const unreadCount = memberActorIds.reduce((count, actorId) => {
      if (!actorId || actorId === senderActorId) return count;

      const lastReadAt = readAtByActorId.get(actorId);
      return lastReadAt === undefined || lastReadAt === null || lastReadAt < messageTime ? count + 1 : count;
    }, 0);

    counts.set(messageId, unreadCount);
    return counts;
  }, new Map<string, number>());
}

export function summarizeGroupChatReactions(input: {
  viewerActorId?: string | null;
  reactions: GroupChatReactionLike[];
}) {
  const viewerActorId = normalizeGroupChatText(input.viewerActorId);
  const grouped = new Map<string, { reaction: string; count: number; reacted_by_me: boolean }>();

  input.reactions.forEach((row) => {
    const reaction = normalizeGroupChatText(row.reaction);
    if (!reaction) return;

    const actorId = normalizeGroupChatText(row.actor_id);
    const current = grouped.get(reaction) ?? { reaction, count: 0, reacted_by_me: false };
    current.count += 1;
    current.reacted_by_me = current.reacted_by_me || Boolean(viewerActorId && actorId === viewerActorId);
    grouped.set(reaction, current);
  });

  return Array.from(grouped.values()).sort((left, right) => {
    if (right.count !== left.count) return right.count - left.count;
    return left.reaction.localeCompare(right.reaction);
  });
}

export function shouldFanoutGroupChatPush(input: {
  senderActorId?: string | null;
  recipientActorId?: string | null;
  recipientMuted?: boolean | null;
}) {
  const senderActorId = normalizeGroupChatText(input.senderActorId);
  const recipientActorId = normalizeGroupChatText(input.recipientActorId);
  if (!senderActorId || !recipientActorId) return false;
  if (senderActorId === recipientActorId) return false;
  return input.recipientMuted !== true;
}

export function buildGroupChatPreview(input: {
  message_type?: GroupChatMessageType | null;
  content?: string | null;
  file_name?: string | null;
}) {
  if (input.message_type === 'image') return '사진';
  if (input.message_type === 'file') return normalizeGroupChatText(input.file_name) || '파일';
  return normalizeGroupChatText(input.content) || '메시지';
}

export function toNotificationRecipientRole(role: GroupChatRole): 'admin' | 'fc' {
  return role === 'fc' ? 'fc' : 'admin';
}
