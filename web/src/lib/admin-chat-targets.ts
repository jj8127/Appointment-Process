export type AdminChatSourceRow = {
  id?: string | null;
  name?: string | null;
  phone?: string | null;
  signup_completed?: boolean | null;
  affiliation?: string | null;
};

export type AdminChatConversationSummary = {
  last_message?: string | null;
  last_time?: string | null;
  unread_count?: number | null;
};

export type AdminChatMessageSummaryRow = {
  sender_id?: string | null;
  receiver_id?: string | null;
  content?: string | null;
  created_at?: string | null;
  is_read?: boolean | null;
};

export type AdminChatTarget = {
  fc_id: string;
  name: string;
  phone: string;
  last_message: string | null;
  last_time: string | null;
  unread_count: number;
};

const DESIGNER_MARKER = '설계매니저';
const nameCollator = new Intl.Collator('ko-KR');

const sanitizePhone = (value: string | null | undefined) => String(value ?? '').replace(/[^0-9]/g, '');

export function buildAdminChatConversationSummaries(input: {
  viewerId: string;
  counterpartPhones: string[];
  messages: AdminChatMessageSummaryRow[];
}): Record<string, AdminChatConversationSummary> {
  const viewerId = String(input.viewerId ?? '').trim();
  if (!viewerId) return {};

  const counterpartSet = new Set(
    input.counterpartPhones
      .map((phone) => sanitizePhone(phone))
      .filter((phone) => phone.length > 0),
  );
  const summariesByPhone: Record<string, AdminChatConversationSummary> = {};

  for (const message of input.messages ?? []) {
    const senderId = String(message.sender_id ?? '').trim();
    const receiverId = String(message.receiver_id ?? '').trim();

    if (senderId !== viewerId && receiverId !== viewerId) {
      continue;
    }

    const rawCounterpart = senderId === viewerId ? receiverId : senderId;
    const counterpartPhone = counterpartSet.has(rawCounterpart) ? rawCounterpart : sanitizePhone(rawCounterpart);
    if (!counterpartSet.has(counterpartPhone)) {
      continue;
    }

    const summary = summariesByPhone[counterpartPhone] ?? {
      last_message: null,
      last_time: null,
      unread_count: 0,
    };
    const createdAt = message.created_at ?? null;
    const currentTime = createdAt ? new Date(createdAt).getTime() : Number.NEGATIVE_INFINITY;
    const lastTime = summary.last_time ? new Date(summary.last_time).getTime() : Number.NEGATIVE_INFINITY;

    if (!summary.last_time || currentTime > lastTime) {
      summary.last_message = message.content ?? null;
      summary.last_time = createdAt;
    }

    if (receiverId === viewerId && sanitizePhone(senderId) === counterpartPhone && message.is_read === false) {
      summary.unread_count = (summary.unread_count ?? 0) + 1;
    }

    summariesByPhone[counterpartPhone] = summary;
  }

  return summariesByPhone;
}

export function buildAdminChatTargets(
  rows: AdminChatSourceRow[],
  summariesByPhone: Record<string, AdminChatConversationSummary> = {},
): AdminChatTarget[] {
  const seenPhones = new Set<string>();
  const targets: AdminChatTarget[] = [];

  for (const row of rows ?? []) {
    if (row?.signup_completed !== true) {
      continue;
    }

    const affiliation = String(row?.affiliation ?? '').trim();
    if (affiliation.includes(DESIGNER_MARKER)) {
      continue;
    }

    const fcId = String(row?.id ?? '').trim();
    const name = String(row?.name ?? '').trim();
    const phone = sanitizePhone(row?.phone);

    if (!fcId || !name || !phone || seenPhones.has(phone)) {
      continue;
    }

    seenPhones.add(phone);
    const summary = summariesByPhone[phone];

    targets.push({
      fc_id: fcId,
      name,
      phone,
      last_message: summary?.last_message ?? null,
      last_time: summary?.last_time ?? null,
      unread_count: summary?.unread_count ?? 0,
    });
  }

  return targets.sort((a, b) => {
    if (a.last_time && b.last_time) {
      return new Date(b.last_time).getTime() - new Date(a.last_time).getTime();
    }
    if (a.last_time) return -1;
    if (b.last_time) return 1;
    return nameCollator.compare(a.name, b.name);
  });
}
