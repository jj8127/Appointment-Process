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
