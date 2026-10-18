import { cleanupFailed } from '@/lib/upstream-response-policy';
import { adminSupabase } from '@/lib/admin-supabase';
import { serverError } from '@/lib/api-error';
import { checkRateLimit, SECURITY_HEADERS } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import {
  isExactNoticeMutationReceipt,
  isNoticeDeleteInput,
  isNoticePatchInput,
  type NoticeDeleteInput,
  type NoticePatchInput,
} from '@/lib/notice-write-contract';
import { collectSupabaseRows } from '@/lib/supabase-query-contract';
import { redactSensitiveText } from '@/lib/sensitive-text';
import { getVerifiedReadOnlyAdminSession } from '@/lib/server-session';
import { isHttpsResponseUrl } from '@/lib/user-intent-policy';
import { NextResponse } from 'next/server';

const BOARD_NOTICE_CATEGORY_SLUG = 'notice';
const BOARD_NOTICE_ID_PREFIX = 'board_notice:';
const BOARD_ATTACHMENT_BUCKET = 'board-attachments';

type NoticeFile = {
  name?: string | null;
  url?: string | null;
  type?: string | null;
  size?: number | null;
};

type NoticeSource = 'legacy_notice' | 'board_notice';

type NoticeRow = {
  id: string;
  title: string;
  body: string;
  category: string | null;
  created_at: string;
  created_by: string | null;
  source: NoticeSource;
  board_post_id?: string | null;
  images?: string[] | null;
  files?: NoticeFile[] | null;
};

type BoardPostRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  author_resident_id: string;
  category_id: string;
};

type BoardAttachmentRow = {
  id: string;
  post_id: string;
  file_type: 'image' | 'file';
  file_name: string;
  mime_type: string | null;
  storage_path: string;
  sort_order: number;
  created_at: string;
};

type LegacyNoticeRow = Omit<NoticeRow, 'source' | 'board_post_id'> & {
  images: string[] | null;
  files: NoticeFile[] | null;
};

type LegacyNoticeFallbackRow = Pick<
  NoticeRow,
  'id' | 'title' | 'body' | 'category' | 'created_at'
>;

type BoardCategoryRow = {
  id: string;
  slug: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

const isNullableString = (value: unknown): value is string | null => (
  value === null || typeof value === 'string'
);

const isValidTimestamp = (value: unknown): value is string => (
  isNonEmptyString(value) && Number.isFinite(Date.parse(value))
);

const isOptionalNullableString = (value: unknown) => (
  value === undefined || value === null || typeof value === 'string'
);

const isNoticeFile = (value: unknown): value is NoticeFile => {
  if (!isRecord(value)) return false;
  return isOptionalNullableString(value.name)
    && (value.url === undefined || value.url === null || isHttpsResponseUrl(value.url))
    && isOptionalNullableString(value.type)
    && (value.size === undefined
      || value.size === null
      || (typeof value.size === 'number' && Number.isFinite(value.size) && value.size >= 0));
};

const isLegacyNoticeFallbackRow = (value: unknown): value is LegacyNoticeFallbackRow => (
  isRecord(value)
  && isNonEmptyString(value.id)
  && typeof value.title === 'string'
  && typeof value.body === 'string'
  && isNullableString(value.category)
  && isValidTimestamp(value.created_at)
);

const isLegacyNoticeRow = (value: unknown): value is LegacyNoticeRow => {
  if (!isLegacyNoticeFallbackRow(value) || !isRecord(value)) return false;
  const row = value as Record<string, unknown>;
  return isNullableString(row.created_by)
    && (row.images === null
      || (Array.isArray(row.images) && row.images.every(isHttpsResponseUrl)))
    && (row.files === null
      || (Array.isArray(row.files) && row.files.every(isNoticeFile)));
};

const isBoardCategoryRow = (value: unknown): value is BoardCategoryRow => (
  isRecord(value)
  && isNonEmptyString(value.id)
  && value.slug === BOARD_NOTICE_CATEGORY_SLUG
);

const isBoardPostRowForCategory = (
  value: unknown,
  categoryId: string,
): value is BoardPostRow => (
  isRecord(value)
  && isNonEmptyString(value.id)
  && typeof value.title === 'string'
  && typeof value.content === 'string'
  && isValidTimestamp(value.created_at)
  && isNonEmptyString(value.author_resident_id)
  && value.category_id === categoryId
);

const isBoardAttachmentRowForPost = (
  value: unknown,
  postId: string,
): value is BoardAttachmentRow => (
  isRecord(value)
  && isNonEmptyString(value.id)
  && value.post_id === postId
  && (value.file_type === 'image' || value.file_type === 'file')
  && isNonEmptyString(value.file_name)
  && isNullableString(value.mime_type)
  && isNonEmptyString(value.storage_path)
  && Number.isSafeInteger(value.sort_order)
  && Number(value.sort_order) >= 0
  && isValidTimestamp(value.created_at)
);

const parseBoardNoticePostId = (id: string): string | null => {
  if (!id.startsWith(BOARD_NOTICE_ID_PREFIX)) return null;
  const postId = id.slice(BOARD_NOTICE_ID_PREFIX.length).trim();
  return postId.length > 0 ? postId : null;
};

const isMissingColumnError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === '42703';

const isMissingRelationError = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === '42P01';

async function getSession() {
  return getVerifiedReadOnlyAdminSession();
}

async function getLegacyNoticeList(): Promise<NoticeRow[]> {
  try {
    const rows = await collectSupabaseRows<LegacyNoticeRow>({
      queryName: 'admin_notices_legacy',
      isRow: isLegacyNoticeRow,
      rowKey: (row) => row.id,
      fetchPage: async (from, to) => adminSupabase
        .from('notices')
        .select('id,title,body,category,created_at,created_by,images,files')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    });
    return rows.map((row) => ({
      ...row,
      source: 'legacy_notice',
      board_post_id: null,
    }));
  } catch (error) {
    // Compatibility path for deployments that predate the attachment/owner columns.
    if (!isMissingColumnError(error)) throw error;
    const rows = await collectSupabaseRows<LegacyNoticeFallbackRow>({
      queryName: 'admin_notices_legacy_fallback',
      isRow: isLegacyNoticeFallbackRow,
      rowKey: (row) => row.id,
      fetchPage: async (from, to) => adminSupabase
        .from('notices')
        .select('id,title,body,category,created_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    });
    return rows.map((row) => ({
      ...row,
      created_by: null,
      images: null,
      files: null,
      source: 'legacy_notice',
      board_post_id: null,
    }));
  }
}

async function getLegacyNoticeById(id: string): Promise<NoticeRow | null> {
  const withAttachments = await adminSupabase
    .from('notices')
    .select('id,title,body,category,created_at,created_by,images,files')
    .eq('id', id)
    .maybeSingle();

  if (!withAttachments.error) {
    if (!withAttachments.data) return null;
    if (!isLegacyNoticeRow(withAttachments.data) || withAttachments.data.id !== id) {
      throw new Error('admin_notices_legacy_detail_row_contract_invalid');
    }
    return {
      ...withAttachments.data,
      source: 'legacy_notice',
      board_post_id: null,
    };
  }

  if (isMissingColumnError(withAttachments.error)) {
    const basic = await adminSupabase
      .from('notices')
      .select('id,title,body,category,created_at')
      .eq('id', id)
      .maybeSingle();

    if (basic.error) throw basic.error;
    if (!basic.data) return null;
    if (!isLegacyNoticeFallbackRow(basic.data) || basic.data.id !== id) {
      throw new Error('admin_notices_legacy_detail_fallback_row_contract_invalid');
    }
    return {
      ...basic.data,
      created_by: null,
      images: null,
      files: null,
      source: 'legacy_notice',
      board_post_id: null,
    };
  }

  throw withAttachments.error;
}

async function getBoardNoticeCategoryId(options: { tolerateMissingRelation?: boolean } = {}): Promise<string | null> {
  const { data, error } = await adminSupabase
    .from('board_categories')
    .select('id,slug')
    .eq('slug', BOARD_NOTICE_CATEGORY_SLUG)
    .maybeSingle();

  if (error) {
    // Board notices did not exist before the board tables were introduced.
    if (options.tolerateMissingRelation && isMissingRelationError(error)) return null;
    throw error;
  }
  if (data === null) return null;
  if (!isBoardCategoryRow(data)) {
    throw new Error('admin_notices_board_category_row_contract_invalid');
  }
  return data.id;
}

async function getBoardAttachmentsByPostId(
  postId: string,
  options: { tolerateMissingRelation?: boolean } = {},
): Promise<BoardAttachmentRow[]> {
  try {
    return await collectSupabaseRows<BoardAttachmentRow>({
      queryName: 'admin_notices_board_attachments',
      isRow: (value): value is BoardAttachmentRow => isBoardAttachmentRowForPost(value, postId),
      rowKey: (row) => row.id,
      fetchPage: async (from, to) => adminSupabase
        .from('board_attachments')
        .select('id,post_id,file_type,file_name,mime_type,storage_path,sort_order,created_at')
        .eq('post_id', postId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    });
  } catch (error) {
    // Compatibility path for deployments that predate board attachments.
    if (options.tolerateMissingRelation && isMissingRelationError(error)) return [];
    throw error;
  }
}

async function createBoardAttachmentSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await adminSupabase.storage
    .from(BOARD_ATTACHMENT_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    logger.warn('[api/admin/notices] board attachment sign failed', {
      category: 'notice',
      reason: 'attachment_sign_failed',
      status: 'warning',
    });
    throw error;
  }

  if (!isHttpsResponseUrl(data?.signedUrl)) {
    throw new Error('admin_notices_board_attachment_signed_url_contract_invalid');
  }
  return data.signedUrl;
}

const mapBoardPostToNotice = (post: BoardPostRow): NoticeRow => ({
  id: `${BOARD_NOTICE_ID_PREFIX}${post.id}`,
  title: redactSensitiveText(post.title, '공지'),
  body: redactSensitiveText(post.content),
  category: '공지',
  created_at: post.created_at,
  created_by: post.author_resident_id,
  source: 'board_notice',
  board_post_id: post.id,
  images: null,
  files: null,
});

const sanitizeNoticeRow = (notice: NoticeRow): NoticeRow => ({
  ...notice,
  title: redactSensitiveText(notice.title, '공지'),
  body: redactSensitiveText(notice.body),
  category: notice.category ? redactSensitiveText(notice.category) : notice.category,
  files: notice.files?.map((file) => ({
    ...file,
    name: file.name ? redactSensitiveText(file.name, 'file') : file.name,
  })) ?? null,
});

async function decorateBoardNoticeWithAttachments(notice: NoticeRow): Promise<NoticeRow> {
  const postId = notice.board_post_id;
  if (!postId) return notice;

  const attachments = await getBoardAttachmentsByPostId(postId);
  if (attachments.length === 0) return notice;

  const signedUrls = await Promise.all(
    attachments.map(async (file) => ({
      file,
      signedUrl: await createBoardAttachmentSignedUrl(file.storage_path),
    })),
  );

  const images = signedUrls
    .filter((item) => item.file.file_type === 'image')
    .map((item) => item.signedUrl);
  const files: NoticeFile[] = signedUrls
    .filter((item) => item.file.file_type === 'file')
    .map((item) => ({
      name: item.file.file_name,
      type: item.file.mime_type ?? undefined,
      url: item.signedUrl,
    }));

  return {
    ...notice,
    images: images.length > 0 ? images : null,
    files: files.length > 0 ? files : null,
  };
}

async function getBoardNoticeList(): Promise<NoticeRow[]> {
  const noticeCategoryId = await getBoardNoticeCategoryId({ tolerateMissingRelation: true });
  if (!noticeCategoryId) return [];

  try {
    const rows = await collectSupabaseRows<BoardPostRow>({
      queryName: 'admin_notices_board_posts',
      isRow: (value): value is BoardPostRow => isBoardPostRowForCategory(value, noticeCategoryId),
      rowKey: (row) => row.id,
      fetchPage: async (from, to) => adminSupabase
        .from('board_posts')
        .select('id,title,content,created_at,author_resident_id,category_id')
        .eq('category_id', noticeCategoryId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to),
    });
    return rows.map(mapBoardPostToNotice);
  } catch (error) {
    // Compatibility path for deployments that predate board posts.
    if (isMissingRelationError(error)) return [];
    throw error;
  }
}

async function getBoardNoticeByPostId(postId: string): Promise<NoticeRow | null> {
  const noticeCategoryId = await getBoardNoticeCategoryId();
  if (!noticeCategoryId) return null;

  const { data, error } = await adminSupabase
    .from('board_posts')
    .select('id,title,content,created_at,author_resident_id,category_id')
    .eq('id', postId)
    .eq('category_id', noticeCategoryId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) return null;
  if (
    !isBoardPostRowForCategory(data, noticeCategoryId)
    || data.id !== postId
  ) {
    throw new Error('admin_notices_board_post_detail_row_contract_invalid');
  }

  const notice = mapBoardPostToNotice(data);
  return decorateBoardNoticeWithAttachments(notice);
}

async function getNoticeList(): Promise<NoticeRow[]> {
  const [legacyNotices, boardNotices] = await Promise.all([
    getLegacyNoticeList(),
    getBoardNoticeList(),
  ]);

  const notices = [...legacyNotices, ...boardNotices].map(sanitizeNoticeRow);
  const ids = new Set(notices.map((notice) => notice.id));
  if (ids.size !== notices.length) {
    throw new Error('admin_notices_combined_row_identity_contract_invalid');
  }
  return notices.sort((a, b) => {
    const timestampOrder = Date.parse(b.created_at) - Date.parse(a.created_at);
    return timestampOrder || b.id.localeCompare(a.id);
  });
}

async function getNoticeById(id: string): Promise<NoticeRow | null> {
  const boardPostId = parseBoardNoticePostId(id);
  if (boardPostId) {
    const notice = await getBoardNoticeByPostId(boardPostId);
    return notice ? sanitizeNoticeRow(notice) : null;
  }
  const notice = await getLegacyNoticeById(id);
  return notice ? sanitizeNoticeRow(notice) : null;
}

async function deleteBoardNoticeByPostId(postId: string): Promise<{ cleanupWarning: boolean } | null> {
  const noticeCategoryId = await getBoardNoticeCategoryId();
  if (!noticeCategoryId) return null;
  const attachments = await getBoardAttachmentsByPostId(postId);
  const storagePaths = attachments
    .map((row) => row.storage_path)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const { data: deletedPost, error: postDeleteError } = await adminSupabase
    .from('board_posts')
    .delete()
    .eq('id', postId)
    .eq('category_id', noticeCategoryId)
    .select('id')
    .maybeSingle();

  if (postDeleteError) throw postDeleteError;
  if (deletedPost?.id !== postId) return null;

  return {
    cleanupWarning: storagePaths.length > 0
      ? await cleanupFailed(() => adminSupabase.storage.from(BOARD_ATTACHMENT_BUCKET).remove(storagePaths))
      : false,
  };
}

export async function GET(req: Request) {
  const sessionCheck = await getSession();
  if (!sessionCheck.ok) {
    return NextResponse.json(
      { error: sessionCheck.error },
      { status: sessionCheck.status, headers: SECURITY_HEADERS },
    );
  }

  const requestUrl = new URL(req.url);
  const id = requestUrl.searchParams.get('id')?.trim() ?? '';
  const rateLimit = checkRateLimit(`notices:list:${sessionCheck.session.residentId}`, 60, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: SECURITY_HEADERS });
  }

  try {
    if (id) {
      const notice = await getNoticeById(id);
      if (!notice) {
        return NextResponse.json({ error: 'Notice not found' }, { status: 404, headers: SECURITY_HEADERS });
      }
      return NextResponse.json(
        { ok: true, notice },
        { headers: SECURITY_HEADERS },
      );
    }

    const notices = await getNoticeList();
    return NextResponse.json(
      { ok: true, notices },
      { headers: SECURITY_HEADERS },
    );
  } catch (error: unknown) {
    return serverError(error, 'api/admin/notices GET', SECURITY_HEADERS);
  }
}

export async function PATCH(req: Request) {
  const sessionCheck = await getSession();
  if (!sessionCheck.ok) {
    return NextResponse.json(
      { error: sessionCheck.error },
      { status: sessionCheck.status, headers: SECURITY_HEADERS },
    );
  }

  const rateLimit = checkRateLimit(`notices:update:${sessionCheck.session.residentId}`, 30, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: SECURITY_HEADERS });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch (err) {
    logger.error('[api/admin/notices][PATCH] invalid json', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: SECURITY_HEADERS });
  }
  if (!isNoticePatchInput(parsedBody)) {
    return NextResponse.json({ error: 'Invalid notice payload' }, { status: 400, headers: SECURITY_HEADERS });
  }
  const body: NoticePatchInput = parsedBody;

  const id = body.id?.trim();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400, headers: SECURITY_HEADERS });
  }
  if (parseBoardNoticePostId(id)) {
    return NextResponse.json(
      { error: '게시판 공지는 게시판에서 수정해주세요.' },
      { status: 400, headers: SECURITY_HEADERS },
    );
  }

  try {
    // Managers can only update their own notices
    if (sessionCheck.session.role === 'manager') {
      const notice = await getNoticeById(id);
      if (!notice) {
        return NextResponse.json({ error: 'Notice not found' }, { status: 404, headers: SECURITY_HEADERS });
      }
      if (notice.created_by !== sessionCheck.session.residentId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: SECURITY_HEADERS });
      }
    }

    const updateFields: Record<string, unknown> = {};
    if (body.title !== undefined) updateFields.title = redactSensitiveText(body.title, '공지');
    if (body.body !== undefined) updateFields.body = redactSensitiveText(body.body);
    if (body.category !== undefined) updateFields.category = redactSensitiveText(body.category);
    if (body.images !== undefined) updateFields.images = body.images;
    if (body.files !== undefined) updateFields.files = body.files;

    const { data: updatedNotice, error } = await adminSupabase
      .from('notices')
      .update(updateFields)
      .eq('id', id)
      .select('id,title,body,category,images,files')
      .maybeSingle();
    if (error) {
      return serverError(error, 'api/admin/notices PATCH update', SECURITY_HEADERS);
    }
    if (!updatedNotice) {
      return NextResponse.json({ error: 'Notice not found' }, { status: 404, headers: SECURITY_HEADERS });
    }
    if (!isExactNoticeMutationReceipt(updatedNotice, { id, ...updateFields })) {
      return NextResponse.json(
        { error: 'Notice update could not be confirmed' },
        { status: 502, headers: SECURITY_HEADERS },
      );
    }
    return NextResponse.json({ ok: true, updatedId: updatedNotice.id }, { headers: SECURITY_HEADERS });
  } catch (error: unknown) {
    return serverError(error, 'api/admin/notices PATCH', SECURITY_HEADERS);
  }
}

export async function DELETE(req: Request) {
  const sessionCheck = await getSession();
  if (!sessionCheck.ok) {
    return NextResponse.json(
      { error: sessionCheck.error },
      { status: sessionCheck.status, headers: SECURITY_HEADERS },
    );
  }

  const rateLimit = checkRateLimit(`notices:delete:${sessionCheck.session.residentId}`, 30, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: SECURITY_HEADERS });
  }

  let parsedBody: unknown;
  try {
    parsedBody = await req.json();
  } catch (err) {
    logger.error('[api/admin/notices][DELETE] invalid json', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: SECURITY_HEADERS });
  }
  if (!isNoticeDeleteInput(parsedBody)) {
    return NextResponse.json({ error: 'Invalid notice payload' }, { status: 400, headers: SECURITY_HEADERS });
  }
  const body: NoticeDeleteInput = parsedBody;

  const id = body.id?.trim();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400, headers: SECURITY_HEADERS });
  }
  const boardPostId = parseBoardNoticePostId(id);

  try {
    // Managers can only delete their own notices
    if (sessionCheck.session.role === 'manager') {
      const notice = await getNoticeById(id);
      if (!notice) {
        return NextResponse.json({ error: 'Notice not found' }, { status: 404, headers: SECURITY_HEADERS });
      }
      if (notice.created_by !== sessionCheck.session.residentId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: SECURITY_HEADERS });
      }
    }

    let cleanupWarning = false;
    if (boardPostId) {
      const deleted = await deleteBoardNoticeByPostId(boardPostId);
      if (!deleted) {
        return NextResponse.json({ error: 'Notice not found' }, { status: 404, headers: SECURITY_HEADERS });
      }
      cleanupWarning = deleted.cleanupWarning;
    } else {
      const { data: deletedNotice, error } = await adminSupabase
        .from('notices')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle();
      if (error) {
        return serverError(error, 'api/admin/notices DELETE legacy', SECURITY_HEADERS);
      }
      if (!deletedNotice) {
        return NextResponse.json({ error: 'Notice not found' }, { status: 404, headers: SECURITY_HEADERS });
      }
      if (deletedNotice.id !== id) {
        return NextResponse.json(
          { error: 'Notice deletion could not be confirmed' },
          { status: 502, headers: SECURITY_HEADERS },
        );
      }
    }

    return NextResponse.json({ ok: true, deletedId: id, cleanupWarning }, { headers: SECURITY_HEADERS });
  } catch (error: unknown) {
    return serverError(error, 'api/admin/notices DELETE', SECURITY_HEADERS);
  }
}
