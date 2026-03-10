import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, requireRole, supabase , dbError } from '../_shared/board.ts';

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
    .select('id,author_role,author_resident_id')
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
  if (body.categoryId) payload.category_id = body.categoryId;
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

  return json({ ok: true }, 200, origin);
});
