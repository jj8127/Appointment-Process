import { QueryReadError } from '@/lib/query-read-error';
import { isHttpsResponseUrl, requireMutationSuccess } from '@/lib/user-intent-policy';

export type AdminNoticeFile = {
  name?: string | null;
  url?: string | null;
  type?: string | null;
  size?: number | null;
};

export type AdminNoticeItem = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  created_at: string;
  created_by: string | null;
  images: string[] | null;
  files: AdminNoticeFile[] | null;
};

export type AdminNoticeDeleteResponse = Record<string, unknown> & {
  ok: true;
  deletedId: string;
  cleanupWarning: boolean;
};

const isOptionalNullableString = (value: unknown) => (
  value === undefined || value === null || typeof value === 'string'
);

const isNullableString = (value: unknown) => value === null || typeof value === 'string';

function isNoticeFile(value: unknown): value is AdminNoticeFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const file = value as Record<string, unknown>;
  return isOptionalNullableString(file.name)
    && (file.url === undefined || file.url === null || isHttpsResponseUrl(file.url))
    && isOptionalNullableString(file.type)
    && (file.size === undefined
      || file.size === null
      || (typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0));
}

function isAdminNoticeItem(value: unknown): value is AdminNoticeItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const notice = value as Record<string, unknown>;
  return typeof notice.id === 'string'
    && notice.id.trim().length > 0
    && typeof notice.title === 'string'
    && typeof notice.body === 'string'
    && isNullableString(notice.category)
    && typeof notice.created_at === 'string'
    && notice.created_at.trim().length > 0
    && Number.isFinite(Date.parse(notice.created_at))
    && isNullableString(notice.created_by)
    && (notice.images === null
      || (Array.isArray(notice.images) && notice.images.every(isHttpsResponseUrl)))
    && (notice.files === null
      || (Array.isArray(notice.files) && notice.files.every(isNoticeFile)));
}

async function requestAdminNotices(query = ''): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/notices${query}`, {
      method: 'GET',
      credentials: 'include',
    });
  } catch {
    throw new QueryReadError();
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new QueryReadError(response.status);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new QueryReadError();
  const record = payload as Record<string, unknown>;
  if (record.ok !== true) throw new QueryReadError();
  return record;
}

export async function fetchAdminNotice(id: string): Promise<AdminNoticeItem> {
  const payload = await requestAdminNotices(`?id=${encodeURIComponent(id)}`);
  if (!isAdminNoticeItem(payload.notice)) throw new QueryReadError();
  return payload.notice;
}

export async function fetchAdminNotices(): Promise<AdminNoticeItem[]> {
  const payload = await requestAdminNotices();
  if (!Array.isArray(payload.notices) || !payload.notices.every(isAdminNoticeItem)) {
    throw new QueryReadError();
  }
  return payload.notices;
}

export async function deleteAdminNotice(id: string): Promise<AdminNoticeDeleteResponse> {
  const response = await fetch('/api/admin/notices', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ id }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && !Array.isArray(payload)
      && typeof (payload as Record<string, unknown>).error === 'string'
      ? String((payload as Record<string, unknown>).error)
      : '삭제에 실패했습니다.';
    throw new Error(message);
  }
  requireMutationSuccess(payload);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('공지사항 삭제 결과를 확인하지 못했습니다.');
  }
  const record = payload as Record<string, unknown>;
  if (record.deletedId !== id || typeof record.cleanupWarning !== 'boolean') {
    throw new Error('공지사항 삭제 결과를 확인하지 못했습니다.');
  }
  return record as AdminNoticeDeleteResponse;
}
