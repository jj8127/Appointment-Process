import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  ATTACHMENT_LIMITS,
  buildCorsHeaders,
  dbError,
  json,
  parseJson,
  redactSensitiveText,
  requireActor,
  requireRole,
  supabase,
} from '../_shared/board.ts';
import {
  isBoardPostWritableByActor,
  isCanonicalBoardAttachmentPath,
} from '../_shared/board-actor-policy.ts';

type FileInput = {
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
  fileType: 'image' | 'file';
  sortOrder?: number;
};

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  postId?: string;
  files?: FileInput[];
};

serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? undefined;
  const corsHeaders = buildCorsHeaders(origin);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, code: 'method_not_allowed', message: 'Method not allowed' }, 405, origin);
  }

  const body = await parseJson<Payload>(req);
  if (!body) return json({ ok: false, code: 'invalid_json', message: 'Invalid JSON' }, 400, origin);

  const actorCheck = await requireActor(req, body, 'board-attachment-finalize', origin);
  if (actorCheck.ok === false) return actorCheck.response;
  const forbidden = requireRole(actorCheck.actor, ['admin', 'manager'], origin);
  if (forbidden) return forbidden;

  const postId = body.postId;
  const files = body.files ?? [];
  if (!postId || files.length === 0) {
    return json({ ok: false, code: 'invalid_payload', message: 'postId and files required' }, 400, origin);
  }
  if (files.length > ATTACHMENT_LIMITS.maxFiles) {
    return json({ ok: false, code: 'file_limit', message: 'too many files' }, 400, origin);
  }

  const invalidFile = files.some((file) => (
    !file
    || (file.fileType !== 'image' && file.fileType !== 'file')
    || typeof file.storagePath !== 'string'
    || typeof file.fileName !== 'string'
    || !file.fileName.trim()
    || file.fileName.trim().length > 180
    || !Number.isSafeInteger(file.fileSize)
    || file.fileSize <= 0
    || (file.mimeType !== undefined && (
      typeof file.mimeType !== 'string'
      || !file.mimeType.trim()
      || file.mimeType.trim().length > 200
    ))
  ));
  if (invalidFile) {
    return json({ ok: false, code: 'invalid_file', message: 'invalid attachment metadata' }, 400, origin);
  }

  const totalSize = files.reduce((sum, file) => sum + file.fileSize, 0);
  if (totalSize > ATTACHMENT_LIMITS.maxTotalBytes) {
    return json({ ok: false, code: 'file_total_limit', message: 'total file size exceeded' }, 400, origin);
  }
  for (const file of files) {
    const maxSize = file.fileType === 'image'
      ? ATTACHMENT_LIMITS.maxImageBytes
      : ATTACHMENT_LIMITS.maxFileBytes;
    if (file.fileSize > maxSize) {
      return json({ ok: false, code: 'file_limit', message: 'file too large' }, 400, origin);
    }
    if (!isCanonicalBoardAttachmentPath({
      postId,
      storagePath: file.storagePath,
      fileName: file.fileName.trim(),
    })) {
      return json({ ok: false, code: 'invalid_storage_path', message: 'invalid attachment storage path' }, 400, origin);
    }
  }

  const storagePaths = files.map((file) => file.storagePath);
  if (new Set(storagePaths).size !== storagePaths.length) {
    return json({ ok: false, code: 'duplicate_attachment', message: 'duplicate attachment path' }, 400, origin);
  }

  const { data: post, error: postError } = await supabase
    .from('board_posts')
    .select('id,author_role,author_resident_id')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    return json({ ok: false, code: 'db_error', message: postError.message }, 500, origin);
  }
  if (!post) {
    return json({ ok: false, code: 'not_found', message: 'post not found' }, 404, origin);
  }
  if (!isBoardPostWritableByActor(actorCheck.actor, {
    authorRole: post.author_role,
    authorResidentId: post.author_resident_id,
  })) {
    return json({ ok: false, code: 'forbidden', message: 'cannot attach files to this post' }, 403, origin);
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('board_attachments')
    .select('id,storage_path')
    .in('storage_path', storagePaths);
  if (existingError) return dbError(existingError, origin);
  if ((existingRows ?? []).length > 0) {
    return json({ ok: false, code: 'duplicate_attachment', message: 'attachment was already finalized' }, 409, origin);
  }

  const verifiedObjects = new Map<string, { size: number; mimeType: string | null }>();
  for (const file of files) {
    const objectName = file.storagePath.slice(`board/${postId}/`.length);
    const { data: objects, error: listError } = await supabase.storage
      .from('board-attachments')
      .list(`board/${postId}`, { limit: 2, search: objectName });
    if (listError) {
      return json({ ok: false, code: 'storage_error', message: 'attachment object verification failed' }, 500, origin);
    }
    const object = (objects ?? []).find((entry) => entry.name === objectName) as {
      name: string;
      metadata?: { size?: unknown; mimetype?: unknown } | null;
    } | undefined;
    const actualSize = Number(object?.metadata?.size);
    const actualMimeType = typeof object?.metadata?.mimetype === 'string'
      ? object.metadata.mimetype.trim()
      : null;
    if (!object || !Number.isSafeInteger(actualSize) || actualSize <= 0 || actualSize !== file.fileSize) {
      return json({ ok: false, code: 'invalid_storage_object', message: 'attachment object does not match metadata' }, 400, origin);
    }
    if (
      file.mimeType
      && actualMimeType
      && actualMimeType.toLowerCase() !== file.mimeType.trim().toLowerCase()
    ) {
      return json({ ok: false, code: 'invalid_storage_object', message: 'attachment MIME type does not match' }, 400, origin);
    }
    verifiedObjects.set(file.storagePath, { size: actualSize, mimeType: actualMimeType });
  }

  const rows = files.map((file) => ({
    post_id: postId,
    file_type: file.fileType,
    file_name: redactSensitiveText(file.fileName.trim()).slice(0, 180),
    file_size: verifiedObjects.get(file.storagePath)?.size ?? file.fileSize,
    mime_type: verifiedObjects.get(file.storagePath)?.mimeType ?? file.mimeType?.trim() ?? null,
    storage_path: file.storagePath,
    sort_order: Number.isFinite(file.sortOrder) ? Math.max(0, Math.trunc(file.sortOrder as number)) : 0,
    created_by_resident_id: actorCheck.actor.residentId,
  }));

  const { error } = await supabase.from('board_attachments').insert(rows);
  if (error) {
    return dbError(error, origin);
  }

  return json({ ok: true }, 200, origin);
});
