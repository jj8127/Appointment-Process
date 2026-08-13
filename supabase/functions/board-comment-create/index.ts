import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, supabase , dbError } from '../_shared/board.ts';
import { validatePersistedNotificationForDelivery } from '../_shared/persisted-notification-delivery.ts';
import type { NotificationTargetV1 } from '../_shared/notification-target.ts';

async function resolveRecipientActorId(role: string, residentId: string): Promise<string | null> {
  const table = role === 'fc'
    ? 'fc_profiles'
    : role === 'manager'
      ? 'manager_accounts'
      : 'admin_accounts';
  let query = supabase.from(table).select('id').eq('phone', residentId);
  query = role === 'fc'
    ? query.eq('signup_completed', true)
    : query.eq('active', true);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return typeof data?.id === 'string' ? data.id : null;
}

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

  const actorCheck = await requireActor(req, body, 'board-comment-create', origin);
  if (actorCheck.ok === false) return actorCheck.response;

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
    return dbError(error, origin);
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

  let notificationStored = true;
  let notificationIds: string[] = [];
  if (recipients.size > 0) {
    try {
      const target: NotificationTargetV1 = { version: 1, kind: 'board_post', postId };
      const notificationRows = await Promise.all(
        Array.from(recipients.values()).map(async (recipient) => ({
          recipient_role: recipient.role,
          resident_id: recipient.residentId,
          recipient_actor_id: await resolveRecipientActorId(recipient.role, recipient.residentId),
          title: 'New comment',
          body: post.title ?? 'New comment',
          category: parentId ? 'board_reply' : 'board_comment',
          target,
          target_url: `/board?postId=${postId}`,
        })),
      );
      const actorBoundRows = notificationRows.filter((row) => Boolean(row.recipient_actor_id));
      if (actorBoundRows.length !== notificationRows.length) {
        notificationStored = false;
      } else {
        const { data: persistedRows, error: notificationError } = await supabase
          .from('notifications')
          .insert(actorBoundRows)
          .select('id,target,recipient_role,recipient_actor_id,resident_id');
        if (notificationError || (persistedRows?.length ?? 0) !== actorBoundRows.length) {
          notificationStored = false;
        } else {
          notificationIds = (persistedRows ?? []).flatMap((row) => {
            const expected = actorBoundRows.find((candidate) =>
              candidate.recipient_actor_id === row.recipient_actor_id
            );
            if (!expected) return [];
            const validation = validatePersistedNotificationForDelivery(row, {
              target,
              recipientRole: expected.recipient_role as 'admin' | 'fc' | 'manager',
              recipientActorId: expected.recipient_actor_id,
              residentId: expected.resident_id,
            });
            return validation.ok ? [validation.notificationId] : [];
          });
          notificationStored = notificationIds.length === actorBoundRows.length;
        }
      }
    } catch {
      notificationStored = false;
    }
  }

  return json({
    ok: true,
    data: { id: created.id },
    notification: {
      notificationStored,
      pushStatus: 'not_attempted',
      retryable: !notificationStored,
      ...(notificationIds.length > 0 ? { notificationIds } : {}),
    },
    notificationWarning: notificationStored ? null : 'notification_delivery_incomplete',
  }, 200, origin);
});
