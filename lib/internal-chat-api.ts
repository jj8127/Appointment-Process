import { logger } from './logger';
import { parseOptionalCursorPaginationMetadata } from './list-pagination-contract';
import { sanitizePhone } from './messenger-participants';
import { isNotificationUuid } from './notification-target';
import { getStaffChatActorId, type StaffType } from './staff-identity';

type AppRole = 'admin' | 'fc' | null;

type FcNotifySuccess = {
  ok: true;
  message?: string;
};

export type InternalChatListItem = {
  conversation_id: string | null;
  target_id?: string;
  fc_id: string;
  name: string;
  phone: string;
  affiliation: string | null;
  last_message: string | null;
  last_time: string | null;
  unread_count: number;
};

type InternalChatListWireItem = Omit<InternalChatListItem, 'conversation_id'> & {
  conversation_id?: unknown;
};

export type InternalUnreadCountResponse = {
  count?: unknown;
};

export type ChatTargetWithUnread = {
  name: string;
  phone: string;
  affiliation?: string | null;
  conversation_id?: string | null;
  unread_count: number;
  last_message?: string | null;
  last_time?: string | null;
  staff_type?: string | null;
};

type InternalChatListResponse = FcNotifySuccess & {
  items?: InternalChatListWireItem[];
  total_unread?: unknown;
  next_cursor?: string | null;
  has_more?: boolean;
  limit?: number;
};

export type InternalChatListPage = {
  items: InternalChatListItem[];
  totalUnread: number;
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
};

type InternalUnreadResponse = FcNotifySuccess & InternalUnreadCountResponse;

type ChatTargetsResponse = FcNotifySuccess & {
  managers?: unknown;
  developers?: unknown;
  admins?: unknown;
  admin_unread_count?: unknown;
};

export type InternalChatViewerPayload = {
  viewer_id: string;
  viewer_role: 'admin' | 'fc';
  viewer_staff_type: StaffType;
  viewer_read_only: boolean;
  viewer_is_request_board_designer: boolean;
};

export type InternalChatViewerContext = {
  role: AppRole;
  residentId?: string | null;
  readOnly?: boolean;
  staffType?: StaffType;
  isRequestBoardDesigner?: boolean;
};

export function buildInternalChatViewerPayload(
  input: InternalChatViewerContext,
): InternalChatViewerPayload | null {
  if (!input.role) return null;

  const viewerId = input.isRequestBoardDesigner
    ? sanitizePhone(input.residentId)
    : input.role === 'admin'
      ? getStaffChatActorId({
          residentId: input.residentId,
          readOnly: input.readOnly,
          staffType: input.staffType,
        })
      : sanitizePhone(input.residentId);

  if (!viewerId) return null;

  return {
    viewer_id: viewerId,
    viewer_role: input.role,
    viewer_staff_type: input.staffType ?? null,
    viewer_read_only: Boolean(input.readOnly),
    viewer_is_request_board_designer: Boolean(input.isRequestBoardDesigner),
  };
}

async function invokeFcNotify<T extends FcNotifySuccess>(
  body: Record<string, unknown>,
): Promise<T> {
  const { invokeFcNotify: invokeMobileFcNotify } = await import('./fc-notify-client');
  const { data, error } = await invokeMobileFcNotify<T>(body as Record<string, unknown> & { type: string });
  if (error) {
    throw error;
  }
  if (!data?.ok) {
    throw new Error(data?.message ?? 'fc-notify request failed');
  }
  return data as T;
}

function requireNonNegativeSafeInteger(value: unknown, message: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(message);
  }
  return value as number;
}

export function parseInternalChatListResponse(data: InternalChatListResponse): InternalChatListPage {
  if (!Array.isArray(data.items)) {
    throw new Error('internal chat list response is invalid');
  }
  const items = data.items.map((item) => {
    const phone = sanitizePhone(item.phone);
    const targetId = sanitizePhone(item.target_id ?? item.phone);
    const conversationId = item.conversation_id ?? null;
    if (
      (conversationId !== null && !isNotificationUuid(conversationId))
      || !isNotificationUuid(item.fc_id)
      || phone.length !== 11
      || targetId !== phone
      || typeof item.name !== 'string'
      || !Number.isSafeInteger(item.unread_count)
      || item.unread_count < 0
    ) {
      throw new Error('internal chat list item is invalid');
    }
    return {
      ...item,
      conversation_id: conversationId,
      phone,
      target_id: targetId,
    };
  });
  const totalUnread = requireNonNegativeSafeInteger(
    data.total_unread,
    'internal chat unread count is invalid',
  );
  const pagination = parseOptionalCursorPaginationMetadata(data);
  if (!pagination) {
    throw new Error('internal chat list pagination is invalid');
  }
  const limit = Number(data.limit ?? items.length);
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10_000) {
    throw new Error('internal chat list limit is invalid');
  }
  return { items, totalUnread, ...pagination, limit };
}

function parseChatTarget(value: unknown): ChatTargetWithUnread | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.phone !== 'string') return null;
  const phone = sanitizePhone(row.phone);
  const conversationId = row.conversation_id;
  if (
    typeof row.name !== 'string'
    || phone.length !== 11
    || !Number.isSafeInteger(row.unread_count)
    || Number(row.unread_count) < 0
    || (conversationId !== undefined
      && conversationId !== null
      && !isNotificationUuid(conversationId))
    || (row.affiliation !== undefined
      && row.affiliation !== null
      && typeof row.affiliation !== 'string')
    || (row.last_message !== undefined
      && row.last_message !== null
      && typeof row.last_message !== 'string')
    || (row.last_time !== undefined
      && row.last_time !== null
      && (typeof row.last_time !== 'string'
        || !Number.isFinite(Date.parse(row.last_time))))
    || (row.staff_type !== undefined
      && row.staff_type !== null
      && typeof row.staff_type !== 'string')
  ) {
    return null;
  }

  return {
    name: row.name,
    phone,
    unread_count: row.unread_count as number,
    ...(row.affiliation !== undefined ? { affiliation: row.affiliation as string | null } : {}),
    ...(conversationId !== undefined ? { conversation_id: conversationId as string | null } : {}),
    ...(row.last_message !== undefined ? { last_message: row.last_message as string | null } : {}),
    ...(row.last_time !== undefined ? { last_time: row.last_time as string | null } : {}),
    ...(row.staff_type !== undefined ? { staff_type: row.staff_type as string | null } : {}),
  };
}

function parseChatTargetRows(value: unknown): ChatTargetWithUnread[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map(parseChatTarget);
  return rows.every((row): row is ChatTargetWithUnread => row !== null) ? rows : null;
}

export function parseChatTargetsResponse(data: unknown): {
  managers: ChatTargetWithUnread[];
  developers: ChatTargetWithUnread[];
  admins: ChatTargetWithUnread[];
  adminUnreadCount: number;
} {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('chat targets response is invalid');
  }
  const response = data as ChatTargetsResponse;
  const managers = parseChatTargetRows(response.managers);
  const developers = parseChatTargetRows(response.developers);
  const admins = parseChatTargetRows(response.admins);
  const adminUnreadCount = response.admin_unread_count;
  if (
    response.ok !== true
    || !managers
    || !developers
    || !admins
    || !Number.isSafeInteger(adminUnreadCount)
    || Number(adminUnreadCount) < 0
    || admins.reduce((total, target) => total + target.unread_count, 0) !== adminUnreadCount
  ) {
    throw new Error('chat targets response is invalid');
  }
  return {
    managers,
    developers,
    admins,
    adminUnreadCount: adminUnreadCount as number,
  };
}

export function parseInternalUnreadCountResponse(data: unknown): number {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('internal unread count response is invalid');
  }
  const response = data as FcNotifySuccess & InternalUnreadCountResponse;
  if (response.ok !== true) {
    throw new Error('internal unread count response is invalid');
  }
  return requireNonNegativeSafeInteger(
    response.count,
    'internal unread count response is invalid',
  );
}

export async function fetchInternalChatList(
  input: InternalChatViewerContext,
): Promise<{ items: InternalChatListItem[]; totalUnread: number }> {
  const items: InternalChatListItem[] = [];
  const seenPhones = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let totalUnread: number | null = null;

  do {
    const page = await fetchInternalChatListPage(input, cursor, 50);
    if (totalUnread === null) totalUnread = page.totalUnread;
    for (const item of page.items) {
      if (seenPhones.has(item.phone)) {
        throw new Error('internal chat list pagination contains duplicate rows');
      }
      seenPhones.add(item.phone);
      items.push(item);
    }
    cursor = page.nextCursor;
    if (cursor && seenCursors.has(cursor)) {
      throw new Error('internal chat list pagination did not advance');
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  return { items, totalUnread: totalUnread ?? 0 };
}

export async function fetchInternalChatListPage(
  input: InternalChatViewerContext,
  cursor?: string | null,
  limit = 30,
): Promise<InternalChatListPage> {
  const payload = buildInternalChatViewerPayload(input);
  if (!payload) {
    return { items: [], totalUnread: 0, nextCursor: null, hasMore: false, limit };
  }
  const data = await invokeFcNotify<InternalChatListResponse>({
    type: 'internal_chat_list',
    ...payload,
    limit,
    ...(cursor ? { cursor } : {}),
  });
  // A deployed pre-pagination Edge function can ignore `limit` and return the
  // complete directory without a cursor. Preserve that response: truncating it
  // here would make the omitted people permanently unreachable. A paginated
  // deployment already returns at most `limit` rows and a real next cursor.
  return parseInternalChatListResponse(data);
}

export async function fetchInternalUnreadCount(
  input: InternalChatViewerContext,
): Promise<number> {
  const payload = buildInternalChatViewerPayload(input);
  if (!payload) {
    return 0;
  }

  const data = await invokeFcNotify<InternalUnreadResponse>({
    type: 'internal_unread_count',
    ...payload,
  });

  return parseInternalUnreadCountResponse(data);
}

export async function fetchFcChatTargets(residentId?: string | null): Promise<{
  managers: ChatTargetWithUnread[];
  developers: ChatTargetWithUnread[];
  admins: ChatTargetWithUnread[];
  adminUnreadCount: number;
}> {
  const residentPhone = sanitizePhone(residentId);
  if (!residentPhone) {
    return {
      managers: [],
      developers: [],
      admins: [],
      adminUnreadCount: 0,
    };
  }

  try {
    const data = await invokeFcNotify<ChatTargetsResponse>({
      type: 'chat_targets',
      resident_id: residentPhone,
    });

    return parseChatTargetsResponse(data);
  } catch (error) {
    logger.debug('[internal-chat-api] fetchFcChatTargets failed', error);
    throw error;
  }
}
