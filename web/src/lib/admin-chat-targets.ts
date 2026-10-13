export type AdminChatSourceRow = {
  id: string;
  name: string;
  phone: string;
  signup_completed: boolean;
  affiliation: string | null;
};

export type AdminChatConversationSummary = {
  last_message: string | null;
  last_time: string | null;
  unread_count: number;
};

export type AdminChatConversationRow = {
  id: string;
  fc_id: string;
};

export type AdminChatThreadRow = {
  id: string;
  legacy_conversation_id: string;
};

export type AdminChatTarget = {
  fc_id: string;
  conversation_id?: string | null;
  name: string;
  phone: string;
  last_message: string | null;
  last_time: string | null;
  unread_count: number;
};

const DESIGNER_MARKER = '설계매니저';
const nameCollator = new Intl.Collator('ko-KR');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isTimestamp = (value: unknown): value is string =>
  isNonEmptyString(value) && Number.isFinite(Date.parse(value));

const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const sanitizePhone = (value: string) => value.replace(/[^0-9]/g, '');

export function isAdminChatSourceRow(value: unknown): value is AdminChatSourceRow {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.id)
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.phone)
    && /^010\d{8}$/.test(sanitizePhone(value.phone))
    && typeof value.signup_completed === 'boolean'
    && (typeof value.affiliation === 'string' || value.affiliation === null);
}

export function isAdminChatConversationRow(value: unknown): value is AdminChatConversationRow {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.fc_id);
}

export function isAdminChatThreadRow(value: unknown): value is AdminChatThreadRow {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.legacy_conversation_id);
}

function requireSummary(
  value: AdminChatConversationSummary,
): AdminChatConversationSummary {
  if (!isRecord(value)
    || !(typeof value.last_message === 'string' || value.last_message === null)
    || !(value.last_time === null || isTimestamp(value.last_time))
    || !isNonNegativeInteger(value.unread_count)
  ) {
    throw new Error('admin_chat_summary_contract_invalid');
  }
  return value;
}

export function buildAdminChatTargets(
  rows: AdminChatSourceRow[],
  summariesByPhone: Record<string, AdminChatConversationSummary> = {},
): AdminChatTarget[] {
  if (!Array.isArray(rows) || !isRecord(summariesByPhone)) {
    throw new Error('admin_chat_targets_input_contract_invalid');
  }

  const seenIds = new Set<string>();
  const seenPhones = new Set<string>();
  const targets: AdminChatTarget[] = [];

  for (const row of rows) {
    if (!isAdminChatSourceRow(row)) {
      throw new Error('admin_chat_participant_row_contract_invalid');
    }

    const fcId = row.id.trim();
    const phone = sanitizePhone(row.phone);
    if (seenIds.has(fcId) || seenPhones.has(phone)) {
      throw new Error('admin_chat_participant_identity_contract_invalid');
    }
    seenIds.add(fcId);
    seenPhones.add(phone);

    if (!row.signup_completed || (row.affiliation ?? '').includes(DESIGNER_MARKER)) {
      continue;
    }

    const summary = summariesByPhone[phone]
      ? requireSummary(summariesByPhone[phone])
      : null;
    targets.push({
      fc_id: fcId,
      name: row.name.trim(),
      phone,
      last_message: summary?.last_message ?? null,
      last_time: summary?.last_time ?? null,
      unread_count: summary?.unread_count ?? 0,
    });
  }

  return targets.sort((a, b) => {
    if (a.last_time && b.last_time) {
      if (a.last_time !== b.last_time) {
        return new Date(b.last_time).getTime() - new Date(a.last_time).getTime();
      }
      return b.fc_id.localeCompare(a.fc_id);
    }
    if (a.last_time) return -1;
    if (b.last_time) return 1;
    const byName = nameCollator.compare(a.name, b.name);
    return byName !== 0 ? byName : a.fc_id.localeCompare(b.fc_id);
  });
}
