import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, requireRole, supabase , dbError } from '../_shared/board.ts';
import { resolveCanonicalBoardCategory } from '../_shared/board-categories.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
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

  const actorCheck = await requireActor(req, body, 'board-category-create', origin);
  if (actorCheck.ok === false) return actorCheck.response;
  const forbidden = requireRole(actorCheck.actor, ['admin'], origin);
  if (forbidden) return forbidden;

  const name = (body.name ?? '').trim();
  const slug = (body.slug ?? '').trim();
  if (!name || !slug) {
    return json({ ok: false, code: 'invalid_payload', message: 'name and slug are required' }, 400, origin);
  }
  const canonicalCategory = resolveCanonicalBoardCategory({ name, slug });
  if (!canonicalCategory) {
    return json({ ok: false, code: 'invalid_category', message: 'board category must be one of the canonical categories' }, 400, origin);
  }
  if (body.sortOrder !== undefined && body.sortOrder !== canonicalCategory.sortOrder) {
    return json({ ok: false, code: 'invalid_category', message: 'canonical board category sortOrder cannot be changed' }, 400, origin);
  }
  if (body.isActive === false) {
    return json({ ok: false, code: 'invalid_category', message: 'canonical board categories must stay active' }, 400, origin);
  }

  const { data, error } = await supabase
    .from('board_categories')
    .insert({
      name: canonicalCategory.name,
      slug: canonicalCategory.slug,
      sort_order: canonicalCategory.sortOrder,
      is_active: true,
    })
    .select('id')
    .single();

  if (error) {
    return dbError(error, origin);
  }

  return json({ ok: true, data: { id: data.id } }, 200, origin);
});
