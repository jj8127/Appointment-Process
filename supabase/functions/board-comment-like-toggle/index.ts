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
  commentId?: string;
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

  const actorCheck = await requireActor(req, body, 'board-comment-like-toggle', origin);
  if (actorCheck.ok === false) return actorCheck.response;

  const commentId = body.commentId;
  if (!commentId) {
    return json({ ok: false, code: 'invalid_payload', message: 'commentId is required' }, 400, origin);
  }

  const { data: comment, error: commentError } = await supabase
    .from('board_comments')
    .select('id,post_id,author_resident_id,author_role,content')
    .eq('id', commentId)
    .maybeSingle();

  if (commentError) {
    return json({ ok: false, code: 'db_error', message: commentError.message }, 500, origin);
  }
  if (!comment) {
    return json({ ok: false, code: 'not_found', message: 'comment not found' }, 404, origin);
  }

  const { data: existing, error: existingError } = await supabase
    .from('board_comment_likes')
    .select('id')
    .eq('comment_id', commentId)
    .eq('resident_id', actorCheck.actor.residentId)
    .maybeSingle();

  if (existingError) {
    return json({ ok: false, code: 'db_error', message: existingError.message }, 500, origin);
  }

  let liked = false;
  let notificationStored = true;
  let notificationId: string | null = null;
  if (existing?.id) {
    const { error } = await supabase.from('board_comment_likes').delete().eq('id', existing.id);
    if (error) {
      return dbError(error, origin);
    }
  } else {
    const { error } = await supabase
      .from('board_comment_likes')
      .insert({
        comment_id: commentId,
        resident_id: actorCheck.actor.residentId,
        role: actorCheck.actor.role,
      });
    if (error) {
      return dbError(error, origin);
    }
    liked = true;

    if (comment.author_resident_id !== actorCheck.actor.residentId) {
      try {
        const recipientActorId = await resolveRecipientActorId(
          comment.author_role,
          comment.author_resident_id,
        );
        const target: NotificationTargetV1 = {
          version: 1,
          kind: 'board_post',
          postId: comment.post_id,
        };
        if (!recipientActorId) {
          notificationStored = false;
        } else {
          const { data: persisted, error: notificationError } = await supabase
            .from('notifications')
            .insert({
              recipient_role: comment.author_role,
              resident_id: comment.author_resident_id,
              recipient_actor_id: recipientActorId,
              title: 'New comment like',
              body: comment.content?.slice(0, 120) ?? '',
              category: 'board_comment_like',
              target,
              target_url: `/board?postId=${comment.post_id}`,
            })
            .select('id,target,recipient_role,recipient_actor_id,resident_id')
            .single();
          const validation = notificationError
            ? { ok: false as const, reason: 'notification_insert_failed' as const }
            : validatePersistedNotificationForDelivery(persisted, {
                target,
                recipientRole: comment.author_role as 'admin' | 'fc' | 'manager',
                recipientActorId,
                residentId: comment.author_resident_id,
              });
          notificationStored = validation.ok;
          notificationId = validation.ok ? validation.notificationId : null;
        }
      } catch {
        notificationStored = false;
      }
    }
  }

  const { count } = await supabase
    .from('board_comment_likes')
    .select('id', { count: 'exact', head: true })
    .eq('comment_id', commentId);

  return json({
    ok: true,
    data: { liked, likeCount: count ?? 0 },
    notification: {
      notificationStored,
      pushStatus: 'not_attempted',
      retryable: !notificationStored,
      ...(notificationId ? { notificationId } : {}),
    },
    notificationWarning: notificationStored ? null : 'notification_delivery_incomplete',
  }, 200, origin);
});
