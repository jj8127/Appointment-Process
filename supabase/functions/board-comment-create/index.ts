import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, supabase } from '../_shared/board.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  postId?: string;
  parentId?: string;
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

  const postId = body.postId;
  const content = (body.content ?? '').trim();
  if (!postId || !content) {
    return json({ ok: false, code: 'invalid_payload', message: 'postId and content required' }, 400, origin);
  }

  const { data: post, error: postError } = await supabase
    .from('board_posts')
    .select('id,author_resident_id,author_role,title')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    return json({ ok: false, code: 'db_error', message: postError.message }, 500, origin);
  }
  if (!post) {
    return json({ ok: false, code: 'not_found', message: 'post not found' }, 404, origin);
  }

  let parentId = body.parentId ?? null;
  let threadRootId: string | null = null;
  if (parentId) {
    const { data: parent, error: parentError } = await supabase
      .from('board_comments')
      .select('id,post_id,parent_id,author_resident_id,author_role')
      .eq('id', parentId)
      .maybeSingle();
    if (parentError) {
      return json({ ok: false, code: 'db_error', message: parentError.message }, 500, origin);
    }
    if (!parent || parent.post_id !== postId) {
      return json({ ok: false, code: 'invalid_parent', message: 'parent comment invalid' }, 400, origin);
    }
    if (parent.parent_id) {
      const { data: root, error: rootError } = await supabase
        .from('board_comments')
        .select('id,post_id,parent_id')
        .eq('id', parent.parent_id)
        .maybeSingle();
      if (rootError) {
        return json({ ok: false, code: 'db_error', message: rootError.message }, 500, origin);
      }
      if (!root || root.post_id !== postId) {
        return json({ ok: false, code: 'invalid_parent', message: 'parent comment invalid' }, 400, origin);
      }
      if (root.parent_id) {
        return json({ ok: false, code: 'invalid_parent', message: 'reply depth exceeded' }, 400, origin);
      }
      threadRootId = root.id;
    } else {
      threadRootId = parent.id;
    }
  }

  const { data: created, error } = await supabase
    .from('board_comments')
    .insert({
      post_id: postId,
      parent_id: parentId,
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

  const recipients = new Map<string, { residentId: string; role: string }>();

  if (post.author_resident_id !== actorCheck.actor.residentId) {
    recipients.set(post.author_resident_id, { residentId: post.author_resident_id, role: post.author_role });
  }

  if (parentId) {
    const threadId = threadRootId ?? parentId;
    const { data: threadComments } = await supabase
      .from('board_comments')
      .select('author_resident_id,author_role')
      .or(`id.eq.${threadId},parent_id.eq.${threadId},id.eq.${parentId},parent_id.eq.${parentId}`);

    (threadComments ?? []).forEach((row) => {
      if (row.author_resident_id === actorCheck.actor.residentId) return;
      recipients.set(row.author_resident_id, { residentId: row.author_resident_id, role: row.author_role });
    });
  }

  if (recipients.size > 0) {
    const notificationRows = Array.from(recipients.values()).map((recipient) => ({
      recipient_role: recipient.role,
      resident_id: recipient.residentId,
      title: 'New comment',
      body: post.title ?? 'New comment',
      category: parentId ? 'board_reply' : 'board_comment',
    }));
    await supabase.from('notifications').insert(notificationRows);
  }

  return json({ ok: true, data: { id: created.id } }, 200, origin);
});
