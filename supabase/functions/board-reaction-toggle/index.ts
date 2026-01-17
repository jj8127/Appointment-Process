import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, supabase } from '../_shared/board.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  postId?: string;
  reactionType?: 'like' | 'heart' | 'check' | 'smile';
};

const REACTION_TYPES = ['like', 'heart', 'check', 'smile'];

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

  const postId = body.postId;
  const reactionType = body.reactionType;
  if (!postId || !reactionType || !REACTION_TYPES.includes(reactionType)) {
    return json({ ok: false, code: 'invalid_payload', message: 'postId and reactionType required' }, 400, origin);
  }

  const { data: post, error: postError } = await supabase
    .from('board_posts')
    .select('id')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    return json({ ok: false, code: 'db_error', message: postError.message }, 500, origin);
  }
  if (!post) {
    return json({ ok: false, code: 'not_found', message: 'post not found' }, 404, origin);
  }

  const { data: existing, error: existingError } = await supabase
    .from('board_post_reactions')
    .select('id,reaction_type')
    .eq('post_id', postId)
    .eq('resident_id', actorCheck.actor.residentId)
    .maybeSingle();

  if (existingError) {
    return json({ ok: false, code: 'db_error', message: existingError.message }, 500, origin);
  }

  let myReaction: Payload['reactionType'] | null = null;
  if (!existing?.id) {
    const { error } = await supabase
      .from('board_post_reactions')
      .insert({
        post_id: postId,
        resident_id: actorCheck.actor.residentId,
        role: actorCheck.actor.role,
        reaction_type: reactionType,
      });
    if (error) {
      return json({ ok: false, code: 'db_error', message: error.message }, 500, origin);
    }
    myReaction = reactionType;
  } else if (existing.reaction_type === reactionType) {
    const { error } = await supabase.from('board_post_reactions').delete().eq('id', existing.id);
    if (error) {
      return json({ ok: false, code: 'db_error', message: error.message }, 500, origin);
    }
    myReaction = null;
  } else {
    const { error } = await supabase
      .from('board_post_reactions')
      .update({ reaction_type: reactionType })
      .eq('id', existing.id);
    if (error) {
      return json({ ok: false, code: 'db_error', message: error.message }, 500, origin);
    }
    myReaction = reactionType;
  }

  return json({ ok: true, data: { myReaction } }, 200, origin);
});
