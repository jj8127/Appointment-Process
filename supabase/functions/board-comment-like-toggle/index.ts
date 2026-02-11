import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, supabase } from '../_shared/board.ts';

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

  const actorCheck = await requireActor(body, origin);
  if (!actorCheck.ok) return actorCheck.response;

  const commentId = body.commentId;
  if (!commentId) {
    return json({ ok: false, code: 'invalid_payload', message: 'commentId is required' }, 400, origin);
  }

  const { data: comment, error: commentError } = await supabase
    .from('board_comments')
    .select('id,post_id,author_resident_id,author_role,content')
    .eq('id', commentId)
    .maybeSingle();

  if (commentError) {
    return json({ ok: false, code: 'db_error', message: commentError.message }, 500, origin);
  }
  if (!comment) {
    return json({ ok: false, code: 'not_found', message: 'comment not found' }, 404, origin);
  }

  const { data: existing, error: existingError } = await supabase
    .from('board_comment_likes')
    .select('id')
    .eq('comment_id', commentId)
    .eq('resident_id', actorCheck.actor.residentId)
    .maybeSingle();

  if (existingError) {
    return json({ ok: false, code: 'db_error', message: existingError.message }, 500, origin);
  }

  let liked = false;
  if (existing?.id) {
    const { error } = await supabase.from('board_comment_likes').delete().eq('id', existing.id);
    if (error) {
      return json({ ok: false, code: 'db_error', message: error.message }, 500, origin);
    }
  } else {
    const { error } = await supabase
      .from('board_comment_likes')
      .insert({
        comment_id: commentId,
        resident_id: actorCheck.actor.residentId,
        role: actorCheck.actor.role,
      });
    if (error) {
      return json({ ok: false, code: 'db_error', message: error.message }, 500, origin);
    }
    liked = true;

    if (comment.author_resident_id !== actorCheck.actor.residentId) {
      await supabase.from('notifications').insert({
        recipient_role: comment.author_role,
        resident_id: comment.author_resident_id,
        title: 'New comment like',
        body: comment.content?.slice(0, 120) ?? '',
        category: 'board_comment_like',
        target_url: `/board-detail?postId=${comment.post_id}`,
      });
    }
  }

  const { count } = await supabase
    .from('board_comment_likes')
    .select('id', { count: 'exact', head: true })
    .eq('comment_id', commentId);

  return json({ ok: true, data: { liked, likeCount: count ?? 0 } }, 200, origin);
});
