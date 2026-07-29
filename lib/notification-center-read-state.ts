import { isNotificationUuid } from './notification-target';

export type NotificationCenterReadRow = {
  rawId: string;
  readAt?: string | null;
};

export type NotificationCenterReadScope = {
  role: 'admin' | 'fc';
  residentId?: string | null;
  requestBoardRole?: 'fc' | 'designer' | null;
};

type MarkReadResult = {
  ok?: unknown;
  authorized?: unknown;
  state?: unknown;
};

type NotificationCenterReadDeps = {
  markRead(notificationIds: string[]): Promise<MarkReadResult>;
  advanceNoticeCheckpoint(
    scope: NotificationCenterReadScope,
    viewedAt: string,
  ): Promise<string>;
  fetchUnreadCount(scope: NotificationCenterReadScope): Promise<number>;
  syncBadge(unreadCount: number): Promise<void>;
  warn(message: string, error: unknown): void;
};

export type NotificationCenterReadResult = {
  requestedReadCount: number;
  readAcknowledged: boolean;
  noticeCheckpointAdvanced: boolean;
  unreadCount: number | null;
};

export function collectVisibleUnreadNotificationIds(
  rows: NotificationCenterReadRow[],
): string[] {
  return Array.from(new Set(
    rows
      .filter((row) => !row.readAt && isNotificationUuid(row.rawId))
      .map((row) => row.rawId),
  ));
}

export async function reconcileNotificationCenterReadState(
  input: {
    scope: NotificationCenterReadScope;
    viewedAt: string;
    rows: NotificationCenterReadRow[];
  },
  deps: NotificationCenterReadDeps,
): Promise<NotificationCenterReadResult> {
  const notificationIds = collectVisibleUnreadNotificationIds(input.rows);
  let readAcknowledged = notificationIds.length === 0;
  let noticeCheckpointAdvanced = false;
  let unreadCount: number | null = null;

  if (notificationIds.length > 0) {
    try {
      const result = await deps.markRead(notificationIds);
      readAcknowledged = result.ok === true
        && result.authorized === true
        && (result.state === 'read' || result.state === 'already_read');
      if (!readAcknowledged) {
        deps.warn(
          '[notifications] visible notification acknowledgement rejected',
          new Error('notification acknowledgement rejected'),
        );
      }
    } catch (error) {
      deps.warn('[notifications] visible notification acknowledgement failed', error);
    }
  }

  try {
    await deps.advanceNoticeCheckpoint(input.scope, input.viewedAt);
    noticeCheckpointAdvanced = true;
  } catch (error) {
    deps.warn('[notifications] notice checkpoint advance failed', error);
  }

  try {
    unreadCount = await deps.fetchUnreadCount(input.scope);
    await deps.syncBadge(unreadCount);
  } catch (error) {
    deps.warn('[notifications] unread badge refresh failed', error);
  }

  return {
    requestedReadCount: notificationIds.length,
    readAcknowledged,
    noticeCheckpointAdvanced,
    unreadCount,
  };
}
