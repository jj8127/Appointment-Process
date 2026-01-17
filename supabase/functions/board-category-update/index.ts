import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, requireRole, supabase } from '../_shared/board.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  id?: string;
  name?: string;
  slug?: string;
  sortOrder?: number;
  isActive?: boolean;
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

  if (!body.id) {
    return json({ ok: false, code: 'invalid_payload', message: 'id is required' }, 400, origin);
  }

  const payload: Record<string, unknown> = {};
  if (body.name !== undefined) payload.name = body.name.trim();
  if (body.slug !== undefined) payload.slug = body.slug.trim();
  if (body.sortOrder !== undefined) payload.sort_order = body.sortOrder;
  if (body.isActive !== undefined) payload.is_active = body.isActive;

  if (Object.keys(payload).length === 0) {
    return json({ ok: false, code: 'invalid_payload', message: 'no fields to update' }, 400, origin);
  }

  const { error } = await supabase
    .from('board_categories')
    .update(payload)
    .eq('id', body.id);

  if (error) {
    return json({ ok: false, code: 'db_error', message: error.message }, 500, origin);
  }

  return json({ ok: true }, 200, origin);
});
