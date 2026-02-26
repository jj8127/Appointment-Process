import { adminSupabase } from '@/lib/admin-supabase';
import { checkRateLimit, SECURITY_HEADERS, validateSession } from '@/lib/csrf';
import { logger } from '@/lib/logger';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const BOARD_NOTICE_CATEGORY_SLUG = 'notice';
const BOARD_NOTICE_ID_PREFIX = 'board_notice:';
const BOARD_ATTACHMENT_BUCKET = 'board-attachments';

type DeleteBody = {
  id?: string;
};

type PatchBody = {
  id?: string;
  title?: string;
  body?: string;
  category?: string;
  images?: string[];
  files?: { name: string; size?: number; type?: string; url: string }[];
};

type NoticeFile = {
  name?: string;
  url?: string;
  type?: string;
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
};

type BoardAttachmentRow = {
  post_id: string;
  file_type: 'image' | 'file';
  file_name: string;
  mime_type: string | null;
  storage_path: string;
  sort_order: number;
  created_at: string;
};

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
  const cookieStore = await cookies();
  const session = {
    role: cookieStore.get('session_role')?.value ?? null,
    residentId: cookieStore.get('session_resident')?.value ?? '',
  };

  const valid = validateSession(session);
  if (!valid.valid) {
    return { ok: false as const, status: 401, error: valid.error ?? 'Unauthorized' };
  }

  if (session.role !== 'admin' && session.role !== 'manager') {
    return { ok: false as const, status: 403, error: 'Forbidden' };
  }

  return { ok: true as const, session };
}

async function getLegacyNoticeList(): Promise<NoticeRow[]> {
  const withAttachments = await adminSupabase
    .from('notices')
    .select('id,title,body,category,created_at,created_by,images,files')
    .order('created_at', { ascending: false });

  if (!withAttachments.error) {
    return ((withAttachments.data ?? []) as Omit<NoticeRow, 'source'>[]).map((row) => ({
      ...row,
      source: 'legacy_notice',
      board_post_id: null,
    }));
  }

  // Backward compatible fallback for environments without images/files/created_by columns.
  if (isMissingColumnError(withAttachments.error)) {
    const basic = await adminSupabase
      .from('notices')
      .select('id,title,body,category,created_at')
      .order('created_at', { ascending: false });

    if (basic.error) throw basic.error;
    return ((basic.data ?? []) as Omit<NoticeRow, 'source'>[]).map((row) => ({
      ...row,
      created_by: null,
      images: null,
      files: null,
      source: 'legacy_notice',
      board_post_id: null,
    }));
  }

  throw withAttachments.error;
}

async function getLegacyNoticeById(id: string): Promise<NoticeRow | null> {
  const withAttachments = await adminSupabase
    .from('notices')
    .select('id,title,body,category,created_at,created_by,images,files')
    .eq('id', id)
    .maybeSingle();

  if (!withAttachments.error) {
    if (!withAttachments.data) return null;
    return {
      ...(withAttachments.data as Omit<NoticeRow, 'source'>),
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
    return {
      ...(basic.data as Omit<NoticeRow, 'source'>),
      created_by: null,
      images: null,
      files: null,
      source: 'legacy_notice',
      board_post_id: null,
    };
  }

  throw withAttachments.error;
}

async function getBoardNoticeCategoryId(): Promise<string | null> {
  const { data, error } = await adminSupabase
    .from('board_categories')
    .select('id')
    .eq('slug', BOARD_NOTICE_CATEGORY_SLUG)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }

  return data?.id ?? null;
}

async function getBoardAttachmentsByPostId(postId: string): Promise<BoardAttachmentRow[]> {
  const { data, error } = await adminSupabase
    .from('board_attachments')
    .select('post_id,file_type,file_name,mime_type,storage_path,sort_order,created_at')
    .eq('post_id', postId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }

  return (data ?? []) as BoardAttachmentRow[];
}

async function createBoardAttachmentSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await adminSupabase.storage
    .from(BOARD_ATTACHMENT_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);

  if (error) {
    logger.warn('[api/admin/notices] board attachment sign failed', {
      storagePath,
      message: error.message,
    });
    return null;
  }

  return data?.signedUrl ?? null;
}

const mapBoardPostToNotice = (post: BoardPostRow): NoticeRow => ({
  id: `${BOARD_NOTICE_ID_PREFIX}${post.id}`,
  title: post.title,
  body: post.content,
  category: '공지',
  created_at: post.created_at,
  created_by: post.author_resident_id,
  source: 'board_notice',
  board_post_id: post.id,
  images: null,
  files: null,
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
    .filter((item) => item.file.file_type === 'image' && !!item.signedUrl)
    .map((item) => item.signedUrl as string);
  const files: NoticeFile[] = signedUrls
    .filter((item) => item.file.file_type === 'file' && !!item.signedUrl)
    .map((item) => ({
      name: item.file.file_name,
      type: item.file.mime_type ?? undefined,
      url: item.signedUrl as string,
    }));

  return {
    ...notice,
    images: images.length > 0 ? images : null,
    files: files.length > 0 ? files : null,
  };
}

async function getBoardNoticeList(): Promise<NoticeRow[]> {
  const noticeCategoryId = await getBoardNoticeCategoryId();
  if (!noticeCategoryId) return [];

  const { data, error } = await adminSupabase
    .from('board_posts')
    .select('id,title,content,created_at,author_resident_id')
    .eq('category_id', noticeCategoryId)
    .order('created_at', { ascending: false });

  if (error) {
    if (isMissingRelationError(error)) return [];
    throw error;
  }

  return ((data ?? []) as BoardPostRow[]).map(mapBoardPostToNotice);
}

async function getBoardNoticeByPostId(postId: string): Promise<NoticeRow | null> {
  const noticeCategoryId = await getBoardNoticeCategoryId();
  if (!noticeCategoryId) return null;

  const { data, error } = await adminSupabase
    .from('board_posts')
    .select('id,title,content,created_at,author_resident_id')
    .eq('id', postId)
    .eq('category_id', noticeCategoryId)
    .maybeSingle();

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw error;
  }
  if (!data) return null;

  const notice = mapBoardPostToNotice(data as BoardPostRow);
  return decorateBoardNoticeWithAttachments(notice);
}

async function getNoticeList(): Promise<NoticeRow[]> {
  const [legacyNotices, boardNotices] = await Promise.all([
    getLegacyNoticeList(),
    getBoardNoticeList(),
  ]);

  return [...legacyNotices, ...boardNotices]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

async function getNoticeById(id: string): Promise<NoticeRow | null> {
  const boardPostId = parseBoardNoticePostId(id);
  if (boardPostId) {
    return getBoardNoticeByPostId(boardPostId);
  }
  return getLegacyNoticeById(id);
}

async function deleteBoardNoticeByPostId(postId: string): Promise<void> {
  const attachments = await getBoardAttachmentsByPostId(postId);
  const storagePaths = attachments
    .map((row) => row.storage_path)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const { error: postDeleteError } = await adminSupabase
    .from('board_posts')
    .delete()
    .eq('id', postId);

  if (postDeleteError) throw postDeleteError;

  if (storagePaths.length > 0) {
    const { error: storageError } = await adminSupabase.storage
      .from(BOARD_ATTACHMENT_BUCKET)
      .remove(storagePaths);
    if (storageError) {
      logger.warn('[api/admin/notices] board attachment cleanup failed', {
        postId,
        count: storagePaths.length,
        message: storageError.message,
      });
    }
  }
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
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[api/admin/notices][GET] failed', error);
    return NextResponse.json(
      { error: error?.message ?? 'Request failed' },
      { status: 500, headers: SECURITY_HEADERS },
    );
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

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch (err) {
    logger.error('[api/admin/notices][PATCH] invalid json', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: SECURITY_HEADERS });
  }

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
    if (body.title !== undefined) updateFields.title = body.title;
    if (body.body !== undefined) updateFields.body = body.body;
    if (body.category !== undefined) updateFields.category = body.category;
    if (body.images !== undefined) updateFields.images = body.images;
    if (body.files !== undefined) updateFields.files = body.files;

    const { error } = await adminSupabase.from('notices').update(updateFields).eq('id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: SECURITY_HEADERS });
    }
    return NextResponse.json({ ok: true }, { headers: SECURITY_HEADERS });
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[api/admin/notices][PATCH] failed', error);
    return NextResponse.json(
      { error: error?.message ?? 'Request failed' },
      { status: 500, headers: SECURITY_HEADERS },
    );
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

  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch (err) {
    logger.error('[api/admin/notices][DELETE] invalid json', err);
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400, headers: SECURITY_HEADERS });
  }

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

    if (boardPostId) {
      await deleteBoardNoticeByPostId(boardPostId);
    } else {
      const { error } = await adminSupabase.from('notices').delete().eq('id', id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500, headers: SECURITY_HEADERS });
      }
    }

    return NextResponse.json({ ok: true }, { headers: SECURITY_HEADERS });
  } catch (err: unknown) {
    const error = err as Error;
    logger.error('[api/admin/notices][DELETE] failed', error);
    return NextResponse.json(
      { error: error?.message ?? 'Request failed' },
      { status: 500, headers: SECURITY_HEADERS },
    );
  }
}
