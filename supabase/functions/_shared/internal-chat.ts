type InternalChatParticipantLike = {
  fc_id: string;
  name?: string | null;
  phone?: string | null;
  affiliation?: string | null;
};

type InternalChatMessageLike = {
  sender_id?: string | null;
  receiver_id?: string | null;
  content?: string | null;
  created_at?: string | null;
  is_read?: boolean | null;
};

type ContactLike = {
  name?: string | null;
  phone?: string | null;
  staff_type?: string | null;
};

type InternalChatPreview = {
  fc_id: string;
  name: string;
  phone: string;
  affiliation: string | null;
  last_message: string | null;
  last_time: string | null;
  unread_count: number;
};

const normalizeWhitespace = (value?: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();
const sanitizePhone = (value?: string | null) => (value ?? '').replace(/[^0-9]/g, '');

export function isInternalAffiliation(value?: string | null) {
  const normalized = normalizeWhitespace(value).replace(/\s+/g, '');
  if (!normalized) return false;
  if (/\d+본부/.test(normalized)) return true;
  if (/\d+팀/.test(normalized)) return true;
  if (normalized.includes('직할')) return true;
  return false;
}

export function countUnreadBySender(rows: Array<{ sender_id?: string | null }>) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const senderId = String(row.sender_id ?? '').trim();
    if (!senderId) return acc;
    acc[senderId] = (acc[senderId] ?? 0) + 1;
    return acc;
  }, {});
}

export function attachUnreadCountsToContacts<T extends ContactLike>(
  contacts: T[],
  unreadBySender: Record<string, number>,
  options?: {
    defaultUnreadCount?: number;
  },
): Array<T & { unread_count: number }> {
  const defaultUnreadCount = options?.defaultUnreadCount ?? 0;

  return contacts.map((contact) => {
    const phone = sanitizePhone(contact.phone);
    const unreadCount = phone ? (unreadBySender[phone] ?? defaultUnreadCount) : defaultUnreadCount;
    return {
      ...contact,
      unread_count: unreadCount,
    };
  });
}

export function buildInternalChatList(input: {
  viewerId: string;
  participants: InternalChatParticipantLike[];
  messages: InternalChatMessageLike[];
}): {
  items: InternalChatPreview[];
  totalUnread: number;
} {
  const viewerId = String(input.viewerId ?? '').trim();
  if (!viewerId) {
    return { items: [], totalUnread: 0 };
  }

  const participantMap = new Map<string, InternalChatPreview>();

  input.participants.forEach((participant) => {
    const phone = sanitizePhone(participant.phone);
    if (!phone || !isInternalAffiliation(participant.affiliation)) return;

    const displayName = normalizeWhitespace(participant.name) || phone;
    participantMap.set(phone, {
      fc_id: participant.fc_id,
      name: displayName,
      phone,
      affiliation: participant.affiliation ?? null,
      last_message: null,
      last_time: null,
      unread_count: 0,
    });
  });

  input.messages.forEach((message) => {
    const senderId = String(message.sender_id ?? '').trim();
    const receiverId = String(message.receiver_id ?? '').trim();

    if (senderId !== viewerId && receiverId !== viewerId) {
      return;
    }

    const counterpartId = senderId === viewerId ? receiverId : senderId;
    if (!counterpartId) return;

    const preview = participantMap.get(counterpartId);
    if (!preview) return;

    const createdAt = message.created_at ?? null;
    if (
      !preview.last_time
      || (createdAt && new Date(createdAt).getTime() > new Date(preview.last_time).getTime())
    ) {
      preview.last_time = createdAt;
      preview.last_message = message.content ?? null;
    }

    if (receiverId === viewerId && senderId === counterpartId && message.is_read === false) {
      preview.unread_count += 1;
    }
  });

  const items = Array.from(participantMap.values()).sort((left, right) => {
    if (!left.last_time && !right.last_time) return left.name.localeCompare(right.name, 'ko-KR');
    if (!left.last_time) return 1;
    if (!right.last_time) return -1;
    return new Date(right.last_time).getTime() - new Date(left.last_time).getTime();
  });

  return {
    items,
    totalUnread: items.reduce((sum, item) => sum + item.unread_count, 0),
  };
}
