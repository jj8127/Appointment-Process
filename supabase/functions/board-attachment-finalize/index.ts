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
import {
  hasUniqueStringField,
  isBoardAttachmentQueryRow,
  isBoardAuthoredEntityQueryRow,
  isBoardUuid,
} from '../_shared/board-read-contract.ts';
import { parseQueryRows } from '../_shared/query-result-contract.ts';
import { requireMutationRowReceipt } from '../_shared/ux-mutation-contract.ts';

type StorageObjectRow = {
  name: string;
  metadata?: Record<string, unknown> | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStorageObjectRow(value: unknown): value is StorageObjectRow {
  return isRecord(value)
    && typeof value.name === 'string'
    && value.name.length > 0
    && (value.metadata === undefined || value.metadata === null || isRecord(value.metadata));
}

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

  const postId = isBoardUuid(body.postId) ? body.postId.toLowerCase() : null;
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
    || (file.sortOrder !== undefined && (
      !Number.isSafeInteger(file.sortOrder)
      || file.sortOrder < 0
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
    return dbError(postError, origin);
  }
  if (!post) {
    return json({ ok: false, code: 'not_found', message: 'post not found' }, 404, origin);
  }
  if (!isBoardAuthoredEntityQueryRow(post) || post.id !== postId) {
    return json({ ok: false, code: 'invalid_query_result', message: '게시글 조회 결과를 확인하지 못했습니다.' }, 502, origin);
  }
  if (!isBoardPostWritableByActor(actorCheck.actor, {
    authorRole: post.author_role,
    authorResidentId: post.author_resident_id,
  })) {
    return json({ ok: false, code: 'forbidden', message: 'cannot attach files to this post' }, 403, origin);
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('board_attachments')
    .select('id,post_id,file_type,file_name,file_size,mime_type,storage_path,sort_order,created_at')
    .in('storage_path', storagePaths);
  if (existingError) return dbError(existingError, origin);
  const parsedExistingRows = parseQueryRows(existingRows, isBoardAttachmentQueryRow);
  if (
    !parsedExistingRows
    || !hasUniqueStringField(parsedExistingRows, 'id')
    || !hasUniqueStringField(parsedExistingRows, 'storage_path')
  ) {
    return json({ ok: false, code: 'invalid_query_result', message: '기존 첨부파일 조회 결과를 확인하지 못했습니다.' }, 502, origin);
  }
  if (parsedExistingRows.length > 0) {
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
    const objectRows = parseQueryRows(objects, isStorageObjectRow);
    if (!objectRows) {
      return json({ ok: false, code: 'invalid_storage_result', message: 'attachment object verification failed' }, 502, origin);
    }
    const matchedObjects = objectRows.filter((entry) => entry.name === objectName);
    if (matchedObjects.length !== 1) {
      return json({ ok: false, code: 'invalid_storage_object', message: 'attachment object does not match metadata' }, 400, origin);
    }
    const object = matchedObjects[0];
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
    sort_order: file.sortOrder ?? 0,
    created_by_resident_id: actorCheck.actor.residentId,
  }));

  const { data: inserted, error } = await supabase
    .from('board_attachments')
    .insert(rows)
    .select('id,post_id,file_type,file_name,file_size,mime_type,storage_path,sort_order,created_at,created_by_resident_id');
  if (error) {
    return dbError(error, origin);
  }
  const insertedRows = parseQueryRows(inserted, isBoardAttachmentQueryRow);
  const expectedByPath = new Map(rows.map((row) => [row.storage_path, row]));
  if (
    !insertedRows
    || insertedRows.length !== rows.length
    || !hasUniqueStringField(insertedRows, 'id')
    || !hasUniqueStringField(insertedRows, 'storage_path')
    || insertedRows.some((row) => row.post_id !== postId || !expectedByPath.has(row.storage_path))
  ) {
    return json({
      ok: false,
      code: 'mutation_receipt_unverified',
      message: '첨부파일 저장 결과를 확인하지 못했습니다.',
    }, 502, origin);
  }
  try {
    for (const row of insertedRows) {
      requireMutationRowReceipt(row, expectedByPath.get(row.storage_path)!);
    }
  } catch {
    return json({
      ok: false,
      code: 'mutation_receipt_unverified',
      message: '첨부파일 저장 결과를 확인하지 못했습니다.',
    }, 502, origin);
  }

  const insertedByPath = new Map(insertedRows.map((row) => [row.storage_path, row]));
  return json({
    ok: true,
    data: {
      postId,
      attachments: storagePaths.map((storagePath) => ({
        id: insertedByPath.get(storagePath)!.id,
        storagePath,
      })),
    },
  }, 200, origin);
});
