import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, requireRole, supabase } from '../_shared/board.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  postId?: string;
  isPinned?: boolean;
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
  const forbidden = requireRole(actorCheck.actor, ['admin'], origin);
  if (forbidden) return forbidden;

  const postId = body.postId;
  if (!postId || body.isPinned === undefined) {
    return json({ ok: false, code: 'invalid_payload', message: 'postId and isPinned required' }, 400, origin);
  }

  const payload = {
    is_pinned: body.isPinned,
    pinned_at: body.isPinned ? new Date().toISOString() : null,
    pinned_by_resident_id: body.isPinned ? actorCheck.actor.residentId : null,
  };

  const { error } = await supabase
    .from('board_posts')
    .update(payload)
    .eq('id', postId);

  if (error) {
    return json({ ok: false, code: 'db_error', message: error.message }, 500, origin);
  }

  return json({ ok: true }, 200, origin);
});
