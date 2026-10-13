import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, requireRole, supabase , dbError } from '../_shared/board.ts';
import {
  hasUniqueStringField,
  isBoardAttachmentQueryRow,
  isBoardAuthoredEntityQueryRow,
  isBoardUuid,
} from '../_shared/board-read-contract.ts';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';
import { parseQueryRows } from '../_shared/query-result-contract.ts';
import { requireMutationRowReceipt } from '../_shared/ux-mutation-contract.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  postId?: string;
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

  const actorCheck = await requireActor(req, body, 'board-delete', origin);
  if (actorCheck.ok === false) return actorCheck.response;
  const forbidden = requireRole(actorCheck.actor, ['admin', 'manager'], origin);
  if (forbidden) return forbidden;

  const postId = isBoardUuid(body.postId) ? body.postId.toLowerCase() : null;
  if (!postId) {
    return json({ ok: false, code: 'invalid_payload', message: 'postId is required' }, 400, origin);
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
    return json({ ok: false, code: 'forbidden', message: 'cannot delete this post' }, 403, origin);
  }

  const { data: attachments, error: attachError } = await supabase
    .from('board_attachments')
    .select('id,post_id,file_type,file_name,file_size,mime_type,storage_path,sort_order,created_at')
    .eq('post_id', postId);

  if (attachError) {
    return dbError(attachError, origin);
  }
  const attachmentRows = parseQueryRows(attachments, isBoardAttachmentQueryRow);
  if (
    !attachmentRows
    || !hasUniqueStringField(attachmentRows, 'id')
    || !hasUniqueStringField(attachmentRows, 'storage_path')
    || attachmentRows.some((row) => row.post_id !== postId)
  ) {
    return json({ ok: false, code: 'invalid_query_result', message: '첨부파일 조회 결과를 확인하지 못했습니다.' }, 502, origin);
  }

  const storagePaths = attachmentRows.map((row) => row.storage_path);
  if (storagePaths.length > 0) {
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
        message: '게시글 첨부파일 정리를 완료하지 못했습니다. 다시 시도해주세요.',
        retryable: true,
      }, 502, origin);
    }
  }

  const { data, error } = await supabase
    .from('board_posts')
    .delete()
    .eq('id', postId)
    .eq('author_role', post.author_role)
    .eq('author_resident_id', post.author_resident_id)
    .select('id')
    .single();
  if (error) {
    return dbError(error, origin);
  }
  try {
    requireMutationRowReceipt(data, { id: postId });
  } catch {
    return json({
      ok: false,
      code: 'mutation_receipt_unverified',
      message: '게시글 삭제 결과를 확인하지 못했습니다.',
    }, 502, origin);
  }

  return json({ ok: true, data: { postId: data.id, cleanupPending: false } }, 200, origin);
});
