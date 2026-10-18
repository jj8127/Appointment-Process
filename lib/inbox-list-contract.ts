import {
  isNotificationUuid,
  isPlainRecord,
  parseNotificationTarget,
  type NotificationTarget,
} from './notification-target.ts';

const BOARD_NOTICE_ID_PREFIX = 'board_notice:';

export type InboxNotificationPayload = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  target?: unknown;
  target_url?: string | null;
  created_at: string;
  resident_id?: string | null;
  read_at: string | null;
  dismissed_at: string | null;
};

export type InboxNoticeFile = {
  name: string;
  url: string;
  type: string;
};

export type InboxNoticePayload = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  created_at: string;
  images: string[] | null;
  files: InboxNoticeFile[] | null;
  target?: unknown;
};

export type InboxListCursor = {
  created_at: string;
  id: string;
};

export type InboxListPayload = {
  ok: true;
  notifications: InboxNotificationPayload[];
  notices: InboxNoticePayload[];
  notification_has_more: boolean;
  notification_next_cursor: InboxListCursor | null;
  notice_has_more: boolean;
  notice_next_cursor: InboxListCursor | null;
};

export type LatestNoticeSummary = {
  id: string;
  title: string;
  body: string;
  category?: string | null;
  created_at: string;
  target: NotificationTarget;
};

export type LatestNoticePayload = {
  ok: true;
  notice: LatestNoticeSummary | null;
};

const isOptionalNullableString = (value: unknown): boolean =>
  value === undefined || value === null || typeof value === 'string';

const isTimestamp = (value: unknown): value is string =>
  typeof value === 'string'
  && value.trim().length > 0
  && Number.isFinite(Date.parse(value));

const isNullableTimestamp = (value: unknown): value is string | null =>
  value === null || isTimestamp(value);

const isNoticeId = (value: unknown): value is string => {
  if (isNotificationUuid(value)) return true;
  return typeof value === 'string'
    && value.startsWith(BOARD_NOTICE_ID_PREFIX)
    && isNotificationUuid(value.slice(BOARD_NOTICE_ID_PREFIX.length));
};

export const isInboxNotificationPayload = (value: unknown): value is InboxNotificationPayload => {
  if (!isPlainRecord(value)) return false;
  return isNotificationUuid(value.id)
    && typeof value.title === 'string'
    && typeof value.body === 'string'
    && isOptionalNullableString(value.category)
    && isOptionalNullableString(value.target_url)
    && isTimestamp(value.created_at)
    && isOptionalNullableString(value.resident_id)
    && isNullableTimestamp(value.read_at)
    && isNullableTimestamp(value.dismissed_at);
};

const isInboxNoticeFile = (value: unknown): value is InboxNoticeFile =>
  isPlainRecord(value)
  && typeof value.name === 'string'
  && typeof value.url === 'string'
  && typeof value.type === 'string';

const isInboxNoticePayload = (value: unknown): value is InboxNoticePayload => {
  if (!isPlainRecord(value)) return false;
  return isNoticeId(value.id)
    && typeof value.title === 'string'
    && typeof value.body === 'string'
    && isOptionalNullableString(value.category)
    && isTimestamp(value.created_at)
    && (value.images === null
      || (Array.isArray(value.images) && value.images.every((item) => typeof item === 'string')))
    && (value.files === null
      || (Array.isArray(value.files) && value.files.every(isInboxNoticeFile)));
};

const hasUniqueIds = (rows: readonly { id: string }[]): boolean => {
  const normalizedIds = rows.map((row) => row.id.toLowerCase());
  return new Set(normalizedIds).size === normalizedIds.length;
};

const isDescendingByCreatedAtAndId = (
  rows: readonly { id: string; created_at: string }[],
): boolean => {
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const timeComparison = Date.parse(previous.created_at) - Date.parse(current.created_at);
    if (timeComparison < 0 || (timeComparison === 0 && previous.id < current.id)) {
      return false;
    }
  }
  return true;
};

const parseCursor = (
  value: unknown,
  isValidId: (id: unknown) => id is string,
): InboxListCursor | null => {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.length !== 2
    || !keys.includes('created_at')
    || !keys.includes('id')
    || !isTimestamp(value.created_at)
    || !isValidId(value.id)
  ) return null;
  return { created_at: value.created_at, id: value.id };
};

export function parseInboxListPayload(value: unknown): InboxListPayload {
  if (
    !isPlainRecord(value)
    || value.ok !== true
    || !Array.isArray(value.notifications)
    || !value.notifications.every(isInboxNotificationPayload)
    || !hasUniqueIds(value.notifications)
    || !isDescendingByCreatedAtAndId(value.notifications)
    || !Array.isArray(value.notices)
    || !value.notices.every(isInboxNoticePayload)
    || !hasUniqueIds(value.notices)
    || !isDescendingByCreatedAtAndId(value.notices)
  ) {
    throw new Error('notification inbox response is invalid');
  }

  const pagingKeys = [
    'notification_has_more',
    'notification_next_cursor',
    'notice_has_more',
    'notice_next_cursor',
  ] as const;
  const presentPagingKeys = pagingKeys.filter((key) => Object.prototype.hasOwnProperty.call(value, key));
  if (presentPagingKeys.length !== 0 && presentPagingKeys.length !== pagingKeys.length) {
    throw new Error('notification inbox response is invalid');
  }

  let notificationHasMore = false;
  let notificationNextCursor: InboxListCursor | null = null;
  let noticeHasMore = false;
  let noticeNextCursor: InboxListCursor | null = null;
  if (presentPagingKeys.length === pagingKeys.length) {
    notificationNextCursor = value.notification_next_cursor === null
      ? null
      : parseCursor(value.notification_next_cursor, isNotificationUuid);
    noticeNextCursor = value.notice_next_cursor === null
      ? null
      : parseCursor(value.notice_next_cursor, isNoticeId);
    if (
      typeof value.notification_has_more !== 'boolean'
      || typeof value.notice_has_more !== 'boolean'
      || (value.notification_has_more ? notificationNextCursor === null : notificationNextCursor !== null)
      || (value.notice_has_more ? noticeNextCursor === null : noticeNextCursor !== null)
    ) {
      throw new Error('notification inbox response is invalid');
    }
    notificationHasMore = value.notification_has_more;
    noticeHasMore = value.notice_has_more;
  }

  return {
    ok: true,
    notifications: value.notifications,
    notices: value.notices,
    notification_has_more: notificationHasMore,
    notification_next_cursor: notificationNextCursor,
    notice_has_more: noticeHasMore,
    notice_next_cursor: noticeNextCursor,
  };
}

export function parseLatestNoticePayload(value: unknown): LatestNoticePayload {
  if (!isPlainRecord(value) || value.ok !== true || !('notice' in value)) {
    throw new Error('latest notice response is invalid');
  }
  if (value.notice === null) return { ok: true, notice: null };
  if (!isPlainRecord(value.notice)) {
    throw new Error('latest notice response is invalid');
  }

  const notice = value.notice;
  const target = parseNotificationTarget(notice.target);
  if (
    !isNoticeId(notice.id)
    || typeof notice.title !== 'string'
    || typeof notice.body !== 'string'
    || !isOptionalNullableString(notice.category)
    || !isTimestamp(notice.created_at)
    || !target
  ) {
    throw new Error('latest notice response is invalid');
  }
  const targetMatchesId = target.kind === 'board_post'
    ? notice.id === `${BOARD_NOTICE_ID_PREFIX}${target.postId}`
    : target.kind === 'notice'
      ? notice.id === target.noticeId
      : false;
  if (!targetMatchesId) throw new Error('latest notice response is invalid');

  return {
    ok: true,
    notice: {
      id: notice.id,
      title: notice.title,
      body: notice.body,
      category: notice.category as string | null | undefined,
      created_at: notice.created_at,
      target,
    },
  };
}
