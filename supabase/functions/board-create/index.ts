import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, requireRole, supabase , dbError, redactSensitiveText } from '../_shared/board.ts';
import { isCanonicalBoardCategorySlug } from '../_shared/board-categories.ts';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';

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

type BoardPushTargetRole = 'admin' | 'fc';

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

async function insertNotificationsWithFallback(rows: Array<Record<string, unknown>>) {
  const sanitizedRows = rows.map((row) => ({
    ...row,
    title: redactSensitiveText(String(row.title ?? ''), '알림'),
    body: redactSensitiveText(String(row.body ?? '')),
    category: redactSensitiveText(String(row.category ?? ''), 'board_post'),
    target_url: row.target_url ? redactSensitiveText(String(row.target_url)) : row.target_url,
  }));
  const firstTry = await supabase.from('notifications').insert(sanitizedRows);
  if (!firstTry.error) return null;

  const missingTargetColumn =
    firstTry.error.code === '42703' || String(firstTry.error.message ?? '').includes('target_url');
  if (!missingTargetColumn) return firstTry.error;

  const fallbackRows = sanitizedRows.map(({ target_url: _ignored, ...row }) => row);
  const secondTry = await supabase.from('notifications').insert(fallbackRows);
  return secondTry.error ?? null;
}

async function sendBoardPush(targetRole: BoardPushTargetRole, title: string, body: string, url: string) {
  const supabaseUrl = getEnv('SUPABASE_URL')?.trim();
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.warn('[board-create] push skipped: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return;
  }

  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/fc-notify`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({
        type: 'notify',
        target_role: targetRole,
        target_id: null,
        title,
        body,
        category: 'board_post',
        url,
        skip_notification_insert: true,
      }),
    });

    if (!response.ok) {
      reportEdgeDiagnostic({
        event: 'board_create.push_fanout',
        reason: 'upstream_rejected',
        status: response.status,
        retryable: response.status >= 500,
        errorClass: 'upstream',
      });
      return;
    }

    const raw = await response.text().catch(() => '');
    try {
      const parsed = raw ? JSON.parse(raw) as { ok?: boolean; message?: string } : null;
      if (parsed?.ok === false) {
        console.warn('[board-create] push fanout returned not ok', {
          targetRole,
          message: parsed.message ?? 'unknown',
        });
      }
    } catch {
      // Ignore non-JSON success bodies; transport success is enough for best-effort push.
    }
  } catch (error) {
    console.warn('[board-create] push fanout network error', { targetRole, error });
  }
}

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

  const actorCheck = await requireActor(req, body, 'board-create', origin);
  if (actorCheck.ok === false) return actorCheck.response;
  const forbidden = requireRole(actorCheck.actor, ['admin', 'manager'], origin);
  if (forbidden) return forbidden;

  const title = redactSensitiveText(body.title ?? '').trim();
  const content = redactSensitiveText(body.content ?? '').trim();
  const categoryId = body.categoryId;

  if (!title || !content || !categoryId) {
    return json({ ok: false, code: 'invalid_payload', message: 'title, content, categoryId required' }, 400, origin);
  }

  const { data: category, error: categoryError } = await supabase
    .from('board_categories')
    .select('id,is_active,slug')
    .eq('id', categoryId)
    .maybeSingle();

  if (categoryError) {
    return json({ ok: false, code: 'db_error', message: categoryError.message }, 500, origin);
  }
  if (!category?.id || category.is_active !== true || !isCanonicalBoardCategorySlug(category.slug)) {
    return json({ ok: false, code: 'invalid_category', message: 'category not found or inactive' }, 400, origin);
  }
  if (
    actorCheck.authMode === 'automation'
    && (category.slug !== 'general' || !title.startsWith('보험소식 브리핑'))
  ) {
    return json({
      ok: false,
      code: 'automation_forbidden',
      message: 'board automation may create only the canonical insurance digest',
    }, 403, origin);
  }

  const { data, error } = await supabase
    .from('board_posts')
    .insert({
      category_id: categoryId,
      title,
      content,
      author_role: actorCheck.actor.role,
      author_resident_id: actorCheck.actor.residentId,
      author_name: redactSensitiveText(actorCheck.actor.displayName ?? '', '작성자'),
    })
    .select('id')
    .single();

  if (error) {
    return dbError(error, origin);
  }

  const notificationTitle = '새 게시글';
  const targetUrl = `/board?postId=${data.id}`;
  const notificationRows = [
    {
      recipient_role: 'fc',
      resident_id: null,
      title: notificationTitle,
      body: title,
      category: 'board_post',
      target_url: targetUrl,
    },
    {
      recipient_role: 'admin',
      resident_id: null,
      title: notificationTitle,
      body: title,
      category: 'board_post',
      target_url: targetUrl,
    },
    {
      recipient_role: 'manager',
      resident_id: null,
      title: notificationTitle,
      body: title,
      category: 'board_post',
      target_url: targetUrl,
    },
  ];

  const notificationError = await insertNotificationsWithFallback(notificationRows);
  if (notificationError) {
    console.warn('[board-create] notifications insert failed', notificationError.message);
  }

  await Promise.all([
    sendBoardPush('fc', notificationTitle, title, targetUrl),
    sendBoardPush('admin', notificationTitle, title, targetUrl),
  ]);

  return json({ ok: true, data: { id: data.id } }, 200, origin);
});
