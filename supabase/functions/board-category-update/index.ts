import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, requireRole, supabase , dbError } from '../_shared/board.ts';
import { resolveCanonicalBoardCategory } from '../_shared/board-categories.ts';

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

  if (
    body.name === undefined
    && body.slug === undefined
    && body.sortOrder === undefined
    && body.isActive === undefined
  ) {
    return json({ ok: false, code: 'invalid_payload', message: 'no fields to update' }, 400, origin);
  }

  const { data: currentCategory, error: currentCategoryError } = await supabase
    .from('board_categories')
    .select('id,slug')
    .eq('id', body.id)
    .maybeSingle();

  if (currentCategoryError) {
    return dbError(currentCategoryError, origin);
  }
  if (!currentCategory?.id) {
    return json({ ok: false, code: 'not_found', message: 'category not found' }, 404, origin);
  }

  const canonicalCategory = resolveCanonicalBoardCategory({
    slug: body.slug ?? currentCategory.slug,
    name: body.name,
  });
  if (!canonicalCategory) {
    return json({ ok: false, code: 'invalid_category', message: 'board category must be one of the canonical four types' }, 400, origin);
  }
  if (body.sortOrder !== undefined && body.sortOrder !== canonicalCategory.sortOrder) {
    return json({ ok: false, code: 'invalid_category', message: 'canonical board category sortOrder cannot be changed' }, 400, origin);
  }
  if (body.isActive === false) {
    return json({ ok: false, code: 'invalid_category', message: 'canonical board categories must stay active' }, 400, origin);
  }

  const payload: Record<string, unknown> = {
    name: canonicalCategory.name,
    slug: canonicalCategory.slug,
    sort_order: canonicalCategory.sortOrder,
    is_active: true,
  };

  const { error } = await supabase
    .from('board_categories')
    .update(payload)
    .eq('id', body.id);

  if (error) {
    return dbError(error, origin);
  }

  return json({ ok: true }, 200, origin);
});
