import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, dbError, json, parseJson, requireActor, requireRole, supabase } from '../_shared/board.ts';
import {
  hasUniqueStringField,
  isBoardAttachmentQueryRow,
  isBoardAuthoredEntityQueryRow,
  isBoardUuid,
} from '../_shared/board-read-contract.ts';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';
import { parseQueryRows } from '../_shared/query-result-contract.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  postId?: string;
  attachmentIds?: string[];
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

  const actorCheck = await requireActor(req, body, 'board-attachment-delete', origin);
  if (actorCheck.ok === false) return actorCheck.response;
  const forbidden = requireRole(actorCheck.actor, ['admin', 'manager'], origin);
  if (forbidden) return forbidden;

  const postId = isBoardUuid(body.postId) ? body.postId.toLowerCase() : null;
  const rawAttachmentIds = body.attachmentIds;
  if (
    !postId
    || !Array.isArray(rawAttachmentIds)
    || rawAttachmentIds.length === 0
    || !rawAttachmentIds.every(isBoardUuid)
  ) {
    return json({ ok: false, code: 'invalid_payload', message: 'postId and attachmentIds required' }, 400, origin);
  }
  const attachmentIds = rawAttachmentIds.map((id) => id.toLowerCase());
  if (new Set(attachmentIds).size !== attachmentIds.length) {
    return json({ ok: false, code: 'invalid_payload', message: 'attachmentIds must be unique' }, 400, origin);
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

  if (
    actorCheck.actor.role === 'manager'
    && (post.author_role !== 'manager' || post.author_resident_id !== actorCheck.actor.residentId)
  ) {
    return json({ ok: false, code: 'forbidden', message: 'cannot edit this post' }, 403, origin);
  }

  const { data: attachments, error: attachmentError } = await supabase
    .from('board_attachments')
    .select('id,post_id,file_type,file_name,file_size,mime_type,storage_path,sort_order,created_at')
    .eq('post_id', postId)
    .in('id', attachmentIds);

  if (attachmentError) {
    return dbError(attachmentError, origin);
  }
  const attachmentRows = parseQueryRows(attachments, isBoardAttachmentQueryRow);
  if (!attachmentRows) {
    return json({ ok: false, code: 'invalid_query_result', message: '첨부파일 조회 결과를 확인하지 못했습니다.' }, 502, origin);
  }
  if (attachmentRows.length === 0) {
    return json({ ok: false, code: 'not_found', message: 'attachment not found' }, 404, origin);
  }
  const requestedIds = new Set(attachmentIds);
  if (
    attachmentRows.length !== attachmentIds.length
    || !hasUniqueStringField(attachmentRows, 'id')
    || !hasUniqueStringField(attachmentRows, 'storage_path')
    || attachmentRows.some((row) => row.post_id !== postId || !requestedIds.has(row.id))
  ) {
    return json({ ok: false, code: 'invalid_attachment', message: 'attachment not found' }, 400, origin);
  }

  const storagePaths = attachmentRows.map((item) => item.storage_path);
  const { error: storageError } = await supabase.storage.from('board-attachments').remove(storagePaths);
  if (storageError) {
    reportEdgeDiagnostic({
      event: 'board_attachment.storage',
      reason: 'delete_failed',
      retryable: true,
      errorClass: 'upstream',
    });
    return json({
      ok: false,
      code: 'storage_cleanup_failed',
      message: '첨부파일 저장소 정리를 완료하지 못했습니다. 다시 시도해주세요.',
      retryable: true,
    }, 502, origin);
  }

  const { data: deleted, error: deleteError } = await supabase
    .from('board_attachments')
    .delete()
    .eq('post_id', postId)
    .in('id', attachmentIds)
    .in('storage_path', storagePaths)
    .select('id,post_id,file_type,file_name,file_size,mime_type,storage_path,sort_order,created_at');

  if (deleteError) {
    return dbError(deleteError, origin);
  }
  const deletedRows = parseQueryRows(deleted, isBoardAttachmentQueryRow);
  const deletedIds = new Set(deletedRows?.map((row) => row.id));
  const deletedPaths = new Set(deletedRows?.map((row) => row.storage_path));
  if (
    !deletedRows
    || deletedRows.length !== attachmentRows.length
    || !hasUniqueStringField(deletedRows, 'id')
    || !hasUniqueStringField(deletedRows, 'storage_path')
    || deletedRows.some((row) => row.post_id !== postId)
    || attachmentIds.some((id) => !deletedIds.has(id))
    || storagePaths.some((path) => !deletedPaths.has(path))
  ) {
    return json({
      ok: false,
      code: 'mutation_receipt_unverified',
      message: '첨부파일 삭제 결과를 확인하지 못했습니다.',
    }, 502, origin);
  }

  const deletedById = new Map(deletedRows.map((row) => [row.id, row]));
  return json({
    ok: true,
    data: {
      postId,
      deletedAttachments: attachmentIds.map((id) => ({
        id,
        storagePath: deletedById.get(id)!.storage_path,
      })),
      cleanupPending: false,
    },
  }, 200, origin);
});
