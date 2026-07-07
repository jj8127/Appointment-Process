import { logger } from './logger';
import { sanitizePhone } from './messenger-participants';
import { getStaffChatActorId, type StaffType } from './staff-identity';

type AppRole = 'admin' | 'fc' | null;

type FcNotifySuccess = {
  ok: true;
  message?: string;
};

export type InternalChatListItem = {
  fc_id: string;
  name: string;
  phone: string;
  affiliation: string | null;
  last_message: string | null;
  last_time: string | null;
  unread_count: number;
};

export type InternalUnreadCountResponse = {
  count: number;
};

export type ChatTargetWithUnread = {
  name: string;
  phone: string;
  unread_count: number;
  staff_type?: string | null;
};

type InternalChatListResponse = FcNotifySuccess & {
  items?: InternalChatListItem[];
  total_unread?: number;
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
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase.functions.invoke('fc-notify', { body });
  if (error) {
    throw error;
  }
  if (!data?.ok) {
    throw new Error(data?.message ?? 'fc-notify request failed');
  }
  return data as T;
}

export async function fetchInternalChatList(
  input: InternalChatViewerContext,
): Promise<{ items: InternalChatListItem[]; totalUnread: number }> {
  const payload = buildInternalChatViewerPayload(input);
  if (!payload) {
    return { items: [], totalUnread: 0 };
  }

  const data = await invokeFcNotify<InternalChatListResponse>({
    type: 'internal_chat_list',
    ...payload,
  });

  return {
    items: Array.isArray(data.items) ? data.items : [],
    totalUnread: Number(data.total_unread ?? 0),
  };
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
