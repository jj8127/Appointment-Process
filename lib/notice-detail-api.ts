import { invokeFcNotify } from './fc-notify-client';
import {
  isNotificationUuid,
  notificationTargetsEqual,
  parseNotificationTarget,
} from './notification-target';

export type NoticeAttachedFile = {
  name: string;
  url: string;
  type: string;
};

export type AuthorizedNoticeDetail = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  created_at: string;
  images: string[] | null;
  files: NoticeAttachedFile[] | null;
};

type NoticePayload = {
  id?: unknown;
  title?: unknown;
  body?: unknown;
  category?: unknown;
  created_at?: unknown;
  images?: unknown;
  files?: unknown;
  target?: unknown;
};

type NoticeGetResponse = {
  ok?: unknown;
  authorized?: unknown;
  message?: string;
  notice?: NoticePayload | null;
};

const isAttachedFile = (value: unknown): value is NoticeAttachedFile => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.name === 'string'
    && typeof row.url === 'string'
    && typeof row.type === 'string'
  );
};

export async function fetchAuthorizedNoticeDetail(
  noticeId: string,
): Promise<AuthorizedNoticeDetail | null> {
  if (!isNotificationUuid(noticeId)) return null;
  const { data, error } = await invokeFcNotify<NoticeGetResponse>({
    type: 'notice_get',
    notice_id: noticeId,
  });
  if (error) throw error;
  if (data?.ok !== true || data.authorized !== true) {
    throw new Error(data?.message ?? '공지를 불러오지 못했습니다.');
  }

  const row = data.notice;
  const expectedTarget = {
    version: 1,
    kind: 'notice',
    noticeId,
  } as const;
  const storedTarget = parseNotificationTarget(row?.target);
  if (
    !row
    || row.id !== noticeId
    || typeof row.title !== 'string'
    || typeof row.body !== 'string'
    || !storedTarget
    || !notificationTargetsEqual(storedTarget, expectedTarget)
  ) {
    return null;
  }

  return {
    id: noticeId,
    title: row.title,
    body: row.body,
    category: typeof row.category === 'string' ? row.category : '공지',
    created_at:
      typeof row.created_at === 'string'
        ? row.created_at
        : new Date().toISOString(),
    images: Array.isArray(row.images)
      ? row.images.filter((value): value is string => typeof value === 'string')
      : null,
    files: Array.isArray(row.files)
      ? row.files.filter(isAttachedFile)
      : null,
  };
}
