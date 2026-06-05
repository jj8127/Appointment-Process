import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, requireRole, supabase, dbError } from '../_shared/board.ts';
import { isCanonicalBoardCategorySlug } from '../_shared/board-categories.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  postId?: string;
  categoryId?: string;
  title?: string;
  content?: string;
  attachmentOrder?: string[];
};

type BoardPushTargetRole = 'admin' | 'fc';

function getEnv(name: string): string | undefined {
  const g: any = globalThis as any;
  if (g?.Deno?.env?.get) return g.Deno.env.get(name);
  if (g?.process?.env) return g.process.env[name];
  return undefined;
}

async function insertNotificationsWithFallback(rows: Array<Record<string, unknown>>) {
  const firstTry = await supabase.from('notifications').insert(rows);
  if (!firstTry.error) return null;

  const missingTargetColumn =
    firstTry.error.code === '42703' || String(firstTry.error.message ?? '').includes('target_url');
  if (!missingTargetColumn) return firstTry.error;

  const fallbackRows = rows.map(({ target_url: _ignored, ...row }) => row);
  const secondTry = await supabase.from('notifications').insert(fallbackRows);
  return secondTry.error ?? null;
}

async function sendBoardPush(targetRole: BoardPushTargetRole, title: string, body: string, url: string) {
  const supabaseUrl = getEnv('SUPABASE_URL')?.trim();
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!supabaseUrl || !serviceKey) {
    console.warn('[board-update] push skipped: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
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

    const raw = await response.text().catch(() => '');
    if (!response.ok) {
      console.warn('[board-update] push fanout failed', {
        targetRole,
        status: response.status,
        body: raw.slice(0, 300),
      });
      return;
    }

    try {
      const parsed = raw ? JSON.parse(raw) as { ok?: boolean; message?: string } : null;
      if (parsed?.ok === false) {
        console.warn('[board-update] push fanout returned not ok', {
          targetRole,
          message: parsed.message ?? 'unknown',
        });
      }
    } catch {
      // Ignore non-JSON success bodies; transport success is enough for best-effort push.
    }
  } catch (error) {
    console.warn('[board-update] push fanout network error', { targetRole, error });
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

  const actorCheck = await requireActor(body, origin);
  if (!actorCheck.ok) return actorCheck.response;
  const forbidden = requireRole(actorCheck.actor, ['admin', 'manager'], origin);
  if (forbidden) return forbidden;

  const postId = body.postId;
  if (!postId) {
    return json({ ok: false, code: 'invalid_payload', message: 'postId is required' }, 400, origin);
  }

  const { data: post, error: postError } = await supabase
    .from('board_posts')
    .select('id,author_role,author_resident_id,title')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    return json({ ok: false, code: 'db_error', message: postError.message }, 500, origin);
  }
  if (!post) {
    return json({ ok: false, code: 'not_found', message: 'post not found' }, 404, origin);
  }

  if (
    actorCheck.actor.role === 'manager'
    && (post.author_role !== 'manager' || post.author_resident_id !== actorCheck.actor.residentId)
  ) {
    return json({ ok: false, code: 'forbidden', message: 'cannot edit this post' }, 403, origin);
  }

  const payload: Record<string, unknown> = {};
  if (body.categoryId) {
    const { data: category, error: categoryError } = await supabase
      .from('board_categories')
      .select('id,is_active,slug')
      .eq('id', body.categoryId)
      .maybeSingle();

    if (categoryError) {
      return dbError(categoryError, origin);
    }
    if (!category?.id || category.is_active !== true || !isCanonicalBoardCategorySlug(category.slug)) {
      return json({ ok: false, code: 'invalid_category', message: 'category not found or inactive' }, 400, origin);
    }

    payload.category_id = body.categoryId;
  }
  if (body.title !== undefined) payload.title = body.title.trim();
  if (body.content !== undefined) payload.content = body.content.trim();
  const attachmentOrder = Array.isArray(body.attachmentOrder) ? body.attachmentOrder.filter(Boolean) : null;

  if (Object.keys(payload).length === 0 && !attachmentOrder) {
    return json({ ok: false, code: 'invalid_payload', message: 'no fields to update' }, 400, origin);
  }

  if (Object.keys(payload).length > 0) {
    payload.edited_at = new Date().toISOString();

    const { error } = await supabase
      .from('board_posts')
      .update(payload)
      .eq('id', postId);

    if (error) {
      return dbError(error, origin);
    }
  }

  if (attachmentOrder) {
    const uniqueOrder = new Set(attachmentOrder);
    if (uniqueOrder.size !== attachmentOrder.length) {
      return json({ ok: false, code: 'invalid_attachment_order', message: 'duplicate attachment ids' }, 400, origin);
    }

    const { data: currentAttachments, error: attachmentError } = await supabase
      .from('board_attachments')
      .select('id')
      .eq('post_id', postId);

    if (attachmentError) {
      return json({ ok: false, code: 'db_error', message: attachmentError.message }, 500, origin);
    }

    const currentIds = (currentAttachments ?? []).map((item) => item.id);
    if (currentIds.length !== attachmentOrder.length) {
      return json({ ok: false, code: 'invalid_attachment_order', message: 'attachment count mismatch' }, 400, origin);
    }

    const currentSet = new Set(currentIds);
    const isValidOrder = attachmentOrder.every((id) => currentSet.has(id));
    if (!isValidOrder) {
      return json({ ok: false, code: 'invalid_attachment_order', message: 'attachment ids mismatch' }, 400, origin);
    }

    for (let index = 0; index < attachmentOrder.length; index += 1) {
      const attachmentId = attachmentOrder[index];
      const { error: sortError } = await supabase
        .from('board_attachments')
        .update({ sort_order: index })
        .eq('id', attachmentId)
        .eq('post_id', postId);
      if (sortError) {
        return json({ ok: false, code: 'db_error', message: sortError.message }, 500, origin);
      }
    }
  }

  const updatedTitle = typeof body.title === 'string' && body.title.trim()
    ? body.title.trim()
    : String(post.title ?? '게시글');
  const notificationTitle = '게시글 수정';
  const targetUrl = `/board-detail?postId=${postId}`;
  const notificationRows = [
    {
      recipient_role: 'fc',
      resident_id: null,
      title: notificationTitle,
      body: updatedTitle,
      category: 'board_post',
      target_url: targetUrl,
    },
    {
      recipient_role: 'admin',
      resident_id: null,
      title: notificationTitle,
      body: updatedTitle,
      category: 'board_post',
      target_url: targetUrl,
    },
    {
      recipient_role: 'manager',
      resident_id: null,
      title: notificationTitle,
      body: updatedTitle,
      category: 'board_post',
      target_url: targetUrl,
    },
  ];

  const notificationError = await insertNotificationsWithFallback(notificationRows);
  if (notificationError) {
    console.warn('[board-update] notifications insert failed', notificationError.message);
  }

  await Promise.all([
    sendBoardPush('fc', notificationTitle, updatedTitle, targetUrl),
    sendBoardPush('admin', notificationTitle, updatedTitle, targetUrl),
  ]);

  return json({ ok: true }, 200, origin);
});
