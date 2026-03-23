import { logger } from './logger';
import { getNotificationCheckpoint } from './notification-checkpoint';
import { rbGetNotificationUnreadCount } from './request-board-api';
import { supabase } from './supabase';

type Role = 'admin' | 'fc' | null;
type RequestBoardRole = 'fc' | 'designer' | null;

type MobileUnreadNotificationCountOptions = {
  role: Role;
  residentId?: string | null;
  requestBoardRole?: RequestBoardRole;
};

const hasRequestBoardAccess = (
  role: Role,
  requestBoardRole?: RequestBoardRole,
): boolean => role === 'fc' || requestBoardRole === 'fc' || requestBoardRole === 'designer';

export async function fetchMobileUnreadNotificationCount({
  role,
  residentId,
  requestBoardRole = null,
}: MobileUnreadNotificationCountOptions): Promise<number> {
  if (!role) return 0;

  const includeLiveRequestBoardUnread = hasRequestBoardAccess(role, requestBoardRole);

  try {
    const lastCheckDate = await getNotificationCheckpoint({
      role,
      residentId,
      requestBoardRole,
    });

    const { data, error } = await supabase.functions.invoke('fc-notify', {
      body: {
        type: 'inbox_unread_count',
        role,
        resident_id: residentId ?? null,
        since: lastCheckDate.toISOString(),
        exclude_request_board_categories: includeLiveRequestBoardUnread,
      },
    });

    if (error) throw error;
    if (!data?.ok) throw new Error(data?.message ?? '알림 개수 조회 실패');

    let total = Number(data.count ?? 0);

    if (includeLiveRequestBoardUnread) {
      total += await rbGetNotificationUnreadCount();
    }

    return total;
  } catch (err) {
    logger.warn('[mobile-unread-count] fetch failed', err);
    return 0;
  }
}
