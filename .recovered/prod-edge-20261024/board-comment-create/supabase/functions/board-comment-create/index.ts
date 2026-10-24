import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, supabase, dbError } from '../_shared/board.ts';

type Payload = {
  actor?: { role: 'admin' | 'manager' | 'fc'; residentId: string; displayName?: string };
  requestId?: string;
  postId?: string;
  parentId?: string;
  content?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
  const origin = req.headers.get('origin') ?? undefined;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCorsHeaders(origin) });
  if (req.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, 405, origin);
  const body = await parseJson<Payload>(req);
  if (!body) return json({ ok: false, code: 'invalid_json', message: 'Invalid JSON' }, 400, origin);
  const actorCheck = await requireActor(req, body, 'board-comment-create', origin);
  if (actorCheck.ok === false) return actorCheck.response;

  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (typeof body.postId !== 'string' || !uuid.test(body.postId) || !content
    || (body.parentId != null && (typeof body.parentId !== 'string' || !uuid.test(body.parentId)))
    || (body.requestId != null && (typeof body.requestId !== 'string' || !uuid.test(body.requestId)))) {
    return json({ ok: false, code: 'invalid_payload', message: 'Invalid comment request' }, 400, origin);
  }
  // Older clients remain compatible. Deduplication requires an updated client's
  // stable request ID; distinct comments must never be merged by content/time.
  const { data, error } = await supabase.rpc('create_board_comment_idempotent', {
    p_actor_role: actorCheck.actor.role,
    p_actor_phone: actorCheck.actor.residentId,
    p_actor_name: actorCheck.actor.displayName ?? '',
    p_request_id: body.requestId ?? crypto.randomUUID(),
    p_post_id: body.postId,
    p_parent_id: body.parentId ?? null,
    p_content: content,
  });
  if (error) {
    const known = ['invalid_payload', 'invalid_parent', 'post_not_found', 'actor_not_found'];
    if (known.includes(error.message)) {
      const status = error.message === 'actor_not_found' ? 403 : error.message === 'post_not_found' ? 404 : 400;
      return json({ ok: false, code: error.message, message: '댓글을 저장할 수 없습니다.' }, status, origin);
    }
    return dbError(error, origin);
  }
  if (data?.code === 'request_id_conflict') {
    return json({ ok: false, code: data.code, message: '댓글 요청이 변경되었습니다. 다시 작성해주세요.' }, 409, origin);
  }
  if (data?.ok !== true || typeof data?.data?.id !== 'string') return dbError({}, origin);
  // The transaction persists /board?postId=, actor-bound notifications,
  // notificationStored/notificationWarning and the complete replay response.
  return json(data, 200, origin);
});
