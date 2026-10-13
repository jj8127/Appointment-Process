import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, supabase , dbError } from '../_shared/board.ts';
import {
  CANONICAL_BOARD_CATEGORIES,
  CANONICAL_BOARD_CATEGORY_SLUGS,
} from '../_shared/board-categories.ts';
import {
  hasUniqueStringField,
  isBoardCategoryQueryRow,
} from '../_shared/board-read-contract.ts';
import { parseQueryRows } from '../_shared/query-result-contract.ts';

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

  const actorCheck = await requireActor(req, body, 'board-categories-list', origin);
  if (actorCheck.ok === false) return actorCheck.response;

  const query = supabase
    .from('board_categories')
    .select('id,name,slug,sort_order,is_active')
    .eq('is_active', true)
    .in('slug', [...CANONICAL_BOARD_CATEGORY_SLUGS])
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  const { data, error } = await query;
  if (error) {
    return dbError(error, origin);
  }

  const rows = parseQueryRows(data, isBoardCategoryQueryRow);
  const canonicalBySlug = new Map<string, (typeof CANONICAL_BOARD_CATEGORIES)[number]>(
    CANONICAL_BOARD_CATEGORIES.map((category) => [category.slug, category]),
  );
  if (!rows
    || rows.length !== CANONICAL_BOARD_CATEGORIES.length
    || !hasUniqueStringField(rows, 'id')
    || !hasUniqueStringField(rows, 'slug')
    || rows.some((row) => {
      const canonical = canonicalBySlug.get(row.slug);
      return !canonical
        || !row.is_active
        || row.name !== canonical.name
        || row.sort_order !== canonical.sortOrder;
    })) {
    return dbError({ message: 'invalid board category query result' }, origin);
  }

  const items = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }));

  return json({ ok: true, data: items }, 200, origin);
});
