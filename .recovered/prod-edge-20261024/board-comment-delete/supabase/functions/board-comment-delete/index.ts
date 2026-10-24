import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, supabase , dbError } from '../_shared/board.ts';
import {
  isBoardAuthoredEntityQueryRow,
  isBoardUuid,
} from '../_shared/board-read-contract.ts';
import { requireMutationRowReceipt } from '../_shared/ux-mutation-contract.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  commentId?: string;
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

  const actorCheck = await requireActor(req, body, 'board-comment-delete', origin);
  if (actorCheck.ok === false) return actorCheck.response;

  const commentId = isBoardUuid(body.commentId) ? body.commentId.toLowerCase() : null;
  if (!commentId) {
    return json({ ok: false, code: 'invalid_payload', message: 'commentId is required' }, 400, origin);
  }

  const { data: comment, error: commentError } = await supabase
    .from('board_comments')
    .select('id,post_id,author_resident_id,author_role')
    .eq('id', commentId)
    .maybeSingle();

  if (commentError) {
    return dbError(commentError, origin);
  }
  if (!comment) {
    return json({ ok: false, code: 'not_found', message: 'comment not found' }, 404, origin);
  }
  if (
    !isBoardAuthoredEntityQueryRow(comment)
    || !isBoardUuid(comment.post_id)
    || comment.id !== commentId
  ) {
    return json({ ok: false, code: 'invalid_query_result', message: '댓글 조회 결과를 확인하지 못했습니다.' }, 502, origin);
  }

  if (
    comment.author_resident_id !== actorCheck.actor.residentId
    || comment.author_role !== actorCheck.actor.role
  ) {
    return json({ ok: false, code: 'forbidden', message: 'cannot delete this comment' }, 403, origin);
  }

  const { data, error } = await supabase
    .from('board_comments')
    .delete()
    .eq('id', commentId)
    .eq('author_resident_id', actorCheck.actor.residentId)
    .eq('author_role', actorCheck.actor.role)
    .select('id,post_id')
    .single();
  if (error) {
    return dbError(error, origin);
  }
  try {
    requireMutationRowReceipt(data, { id: commentId, post_id: comment.post_id });
  } catch {
    return json({
      ok: false,
      code: 'mutation_receipt_unverified',
      message: '댓글 삭제 결과를 확인하지 못했습니다.',
    }, 502, origin);
  }

  return json({ ok: true, data: { commentId: data.id, postId: data.post_id } }, 200, origin);
});
