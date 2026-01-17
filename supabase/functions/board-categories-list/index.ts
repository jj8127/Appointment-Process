import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, supabase } from '../_shared/board.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
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

  let query = supabase
    .from('board_categories')
    .select('id,name,slug,sort_order,is_active')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (actorCheck.actor.role !== 'admin') {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    return json({ ok: false, code: 'db_error', message: error.message }, 500, origin);
  }

  const items = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }));

  return json({ ok: true, data: items }, 200, origin);
});
