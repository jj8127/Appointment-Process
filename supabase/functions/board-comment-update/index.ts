import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, supabase } from '../_shared/board.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  commentId?: string;
  content?: string;
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

  const actorCheck = await requireActor(body, origin);
  if (!actorCheck.ok) return actorCheck.response;

  const commentId = body.commentId;
  const content = (body.content ?? '').trim();
  if (!commentId || !content) {
    return json({ ok: false, code: 'invalid_payload', message: 'commentId and content required' }, 400, origin);
  }

  const { data: comment, error: commentError } = await supabase
    .from('board_comments')
    .select('id,author_resident_id,author_role')
    .eq('id', commentId)
    .maybeSingle();

  if (commentError) {
    return json({ ok: false, code: 'db_error', message: commentError.message }, 500, origin);
  }
  if (!comment) {
    return json({ ok: false, code: 'not_found', message: 'comment not found' }, 404, origin);
  }

  if (
    comment.author_resident_id !== actorCheck.actor.residentId
    || comment.author_role !== actorCheck.actor.role
  ) {
    return json({ ok: false, code: 'forbidden', message: 'cannot edit this comment' }, 403, origin);
  }

  const { error } = await supabase
    .from('board_comments')
    .update({
      content,
      edited_at: new Date().toISOString(),
    })
    .eq('id', commentId);

  if (error) {
    return json({ ok: false, code: 'db_error', message: error.message }, 500, origin);
  }

  return json({ ok: true }, 200, origin);
});
