import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, requireRole, supabase , dbError } from '../_shared/board.ts';
import { resolveCanonicalBoardCategory } from '../_shared/board-categories.ts';
import { isBoardCategoryQueryRow, isBoardUuid } from '../_shared/board-read-contract.ts';
import { requireMutationRowReceipt } from '../_shared/ux-mutation-contract.ts';

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

  const actorCheck = await requireActor(req, body, 'board-category-update', origin);
  if (actorCheck.ok === false) return actorCheck.response;
  const forbidden = requireRole(actorCheck.actor, ['admin'], origin);
  if (forbidden) return forbidden;

  const categoryId = isBoardUuid(body.id) ? body.id.toLowerCase() : null;
  if (!categoryId) {
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
    .select('id,name,slug,sort_order,is_active')
    .eq('id', categoryId)
    .maybeSingle();

  if (currentCategoryError) {
    return dbError(currentCategoryError, origin);
  }
  if (!currentCategory) {
    return json({ ok: false, code: 'not_found', message: 'category not found' }, 404, origin);
  }
  if (!isBoardCategoryQueryRow(currentCategory) || currentCategory.id !== categoryId) {
    return json({ ok: false, code: 'invalid_query_result', message: '카테고리 조회 결과를 확인하지 못했습니다.' }, 502, origin);
  }

  const canonicalCategory = resolveCanonicalBoardCategory({
    slug: body.slug ?? currentCategory.slug,
    name: body.name,
  });
  if (!canonicalCategory) {
    return json({ ok: false, code: 'invalid_category', message: 'board category must be one of the canonical categories' }, 400, origin);
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

  const { data, error } = await supabase
    .from('board_categories')
    .update(payload)
    .eq('id', categoryId)
    .select('id,name,slug,sort_order,is_active')
    .single();

  if (error) {
    return dbError(error, origin);
  }
  if (!isBoardCategoryQueryRow(data)) {
    return json({
      ok: false,
      code: 'mutation_receipt_unverified',
      message: '카테고리 저장 결과를 확인하지 못했습니다.',
    }, 502, origin);
  }
  try {
    requireMutationRowReceipt(data, { id: categoryId, ...payload });
  } catch {
    return json({
      ok: false,
      code: 'mutation_receipt_unverified',
      message: '카테고리 저장 결과를 확인하지 못했습니다.',
    }, 502, origin);
  }

  return json({
    ok: true,
    data: {
      id: data.id,
      name: data.name,
      slug: data.slug,
      sortOrder: data.sort_order,
      isActive: data.is_active,
    },
  }, 200, origin);
});
