import { logger } from './logger';
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
  count: number;
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
  total_unread?: number;
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
  managers?: ChatTargetWithUnread[];
  developers?: ChatTargetWithUnread[];
  admins?: ChatTargetWithUnread[];
  admin_unread_count?: number;
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

function parseInternalChatListResponse(data: InternalChatListResponse): InternalChatListPage {
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
  const totalUnread = Number(data.total_unread ?? 0);
  if (!Number.isSafeInteger(totalUnread) || totalUnread < 0) {
    throw new Error('internal chat unread count is invalid');
  }
  const nextCursor = typeof data.next_cursor === 'string' && data.next_cursor
    ? data.next_cursor
    : null;
  const hasMore = data.has_more === true && nextCursor !== null;
  const limit = Number(data.limit ?? items.length);
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10_000) {
    throw new Error('internal chat list limit is invalid');
  }
  return { items, totalUnread, nextCursor: hasMore ? nextCursor : null, hasMore, limit };
}

export async function fetchInternalChatList(
  input: InternalChatViewerContext,
): Promise<{ items: InternalChatListItem[]; totalUnread: number }> {
  const payload = buildInternalChatViewerPayload(input);
  if (!payload) return { items: [], totalUnread: 0 };
  const data = await invokeFcNotify<InternalChatListResponse>({
    type: 'internal_chat_list',
    ...payload,
  });
  const page = parseInternalChatListResponse(data);
  return { items: page.items, totalUnread: page.totalUnread };
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

  return Number(data.count ?? 0);
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

    return {
      managers: Array.isArray(data.managers) ? data.managers : [],
      developers: Array.isArray(data.developers) ? data.developers : [],
      admins: Array.isArray(data.admins) ? data.admins : [],
      adminUnreadCount: Number(data.admin_unread_count ?? 0),
    };
  } catch (error) {
    logger.debug('[internal-chat-api] fetchFcChatTargets failed', error);
    throw error;
  }
}
