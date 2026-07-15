import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, redactSensitiveText, requireActor, requireRole, supabase, dbError } from '../_shared/board.ts';
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

  const actorCheck = await requireActor(req, body, 'board-update', origin);
  if (actorCheck.ok === false) return actorCheck.response;
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

  let updateCategory = false;
  let categoryId: string | null = null;
  if (body.categoryId !== undefined) {
    if (typeof body.categoryId !== 'string' || !body.categoryId.trim()) {
      return json({ ok: false, code: 'invalid_category', message: 'categoryId is invalid' }, 400, origin);
    }
    const { data: category, error: categoryError } = await supabase
      .from('board_categories')
      .select('id,is_active,slug')
      .eq('id', body.categoryId.trim())
      .maybeSingle();

    if (categoryError) {
      return dbError(categoryError, origin);
    }
    if (!category?.id || category.is_active !== true || !isCanonicalBoardCategorySlug(category.slug)) {
      return json({ ok: false, code: 'invalid_category', message: 'category not found or inactive' }, 400, origin);
    }

    updateCategory = true;
    categoryId = body.categoryId.trim();
  }

  let updateTitle = false;
  let title: string | null = null;
  if (body.title !== undefined) {
    if (typeof body.title !== 'string') {
      return json({ ok: false, code: 'invalid_title', message: 'title is invalid' }, 400, origin);
    }
    title = redactSensitiveText(body.title).trim();
    if (!title || title.length > 200) {
      return json({ ok: false, code: 'invalid_title', message: 'title is invalid' }, 400, origin);
    }
    updateTitle = true;
  }

  let updateContent = false;
  let content: string | null = null;
  if (body.content !== undefined) {
    if (typeof body.content !== 'string') {
      return json({ ok: false, code: 'invalid_content', message: 'content is invalid' }, 400, origin);
    }
    content = redactSensitiveText(body.content).trim();
    if (!content || content.length > 50_000) {
      return json({ ok: false, code: 'invalid_content', message: 'content is invalid' }, 400, origin);
    }
    updateContent = true;
  }

  const attachmentOrderProvided = body.attachmentOrder !== undefined;
  if (attachmentOrderProvided && !Array.isArray(body.attachmentOrder)) {
    return json({ ok: false, code: 'invalid_attachment_order', message: 'attachmentOrder must be an array' }, 400, origin);
  }
  const attachmentOrder = attachmentOrderProvided
    ? (body.attachmentOrder as unknown[]).map((id) => typeof id === 'string' ? id.trim() : '')
    : null;

  if (!updateCategory && !updateTitle && !updateContent && !attachmentOrderProvided) {
    return json({ ok: false, code: 'invalid_payload', message: 'no fields to update' }, 400, origin);
  }

  if (attachmentOrder !== null) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (attachmentOrder.some((id) => !uuidPattern.test(id))) {
      return json({ ok: false, code: 'invalid_attachment_order', message: 'invalid attachment id' }, 400, origin);
    }
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

  }

  const { error: updateError } = await supabase.rpc('update_board_post_atomic', {
    p_post_id: postId,
    p_update_category: updateCategory,
    p_category_id: categoryId,
    p_update_title: updateTitle,
    p_title: title,
    p_update_content: updateContent,
    p_content: content,
    p_attachment_order: attachmentOrder,
  });
  if (updateError) return dbError(updateError, origin);

  const updatedTitle = title ?? redactSensitiveText(String(post.title ?? '게시글'), '게시글');
  const notificationTitle = '게시글 수정';
  const targetUrl = `/board?postId=${postId}`;
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
