import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, requireRole, supabase } from '../_shared/board.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  categoryId?: string;
  title?: string;
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
  const forbidden = requireRole(actorCheck.actor, ['admin', 'manager'], origin);
  if (forbidden) return forbidden;

  const title = (body.title ?? '').trim();
  const content = (body.content ?? '').trim();
  const categoryId = body.categoryId;

  if (!title || !content || !categoryId) {
    return json({ ok: false, code: 'invalid_payload', message: 'title, content, categoryId required' }, 400, origin);
  }

  const { data: category, error: categoryError } = await supabase
    .from('board_categories')
    .select('id,is_active')
    .eq('id', categoryId)
    .maybeSingle();

  if (categoryError) {
    return json({ ok: false, code: 'db_error', message: categoryError.message }, 500, origin);
  }
  if (!category?.id || category.is_active !== true) {
    return json({ ok: false, code: 'invalid_category', message: 'category not found or inactive' }, 400, origin);
  }

  const { data, error } = await supabase
    .from('board_posts')
    .insert({
      category_id: categoryId,
      title,
      content,
      author_role: actorCheck.actor.role,
      author_resident_id: actorCheck.actor.residentId,
      author_name: actorCheck.actor.displayName ?? '',
    })
    .select('id')
    .single();

  if (error) {
    return json({ ok: false, code: 'db_error', message: error.message }, 500, origin);
  }

  const notificationRows = [
    {
      recipient_role: 'fc',
      resident_id: null,
      title: 'New board post',
      body: title,
      category: 'board_post',
    },
    {
      recipient_role: 'admin',
      resident_id: null,
      title: 'New board post',
      body: title,
      category: 'board_post',
    },
    {
      recipient_role: 'manager',
      resident_id: null,
      title: 'New board post',
      body: title,
      category: 'board_post',
    },
  ];

  await supabase.from('notifications').insert(notificationRows);

  return json({ ok: true, data: { id: data.id } }, 200, origin);
});
