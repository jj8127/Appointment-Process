import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, dbError, json, parseJson, requireActor, supabase } from '../_shared/board.ts';
import { validatePersistedNotificationForDelivery } from '../_shared/persisted-notification-delivery.ts';
import type { NotificationTargetV1 } from '../_shared/notification-target.ts';
import {
  type BoardActorRole,
  isBoardActorRole,
  isBoardAuthoredEntityQueryRow,
  isBoardUuid,
} from '../_shared/board-read-contract.ts';
import { parseQueryCount } from '../_shared/query-result-contract.ts';
import { requireMutationRowReceipt } from '../_shared/ux-mutation-contract.ts';

type CommentRow = {
  id: string;
  post_id: string;
  author_resident_id: string;
  author_role: BoardActorRole;
  content: string;
};
type CommentLikeRow = {
  id: string;
  comment_id: string;
  resident_id: string;
  role: BoardActorRole;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isCommentRow(value: unknown): value is CommentRow {
  if (!isBoardAuthoredEntityQueryRow(value)) return false;
  const row = value as Record<string, unknown>;
  return isBoardUuid(row.post_id) && typeof row.content === 'string';
}

function isCommentLikeRow(value: unknown): value is CommentLikeRow {
  return isRecord(value)
    && isBoardUuid(value.id)
    && isBoardUuid(value.comment_id)
    && typeof value.resident_id === 'string'
    && value.resident_id.length > 0
    && isBoardActorRole(value.role);
}

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
  if (!data) return null;
  if (!isRecord(data) || !isBoardUuid(data.id)) {
    throw new Error('recipient_query_contract_invalid');
  }
  return data.id;
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

  const commentId = isBoardUuid(body.commentId) ? body.commentId.toLowerCase() : null;
  if (!commentId) {
    return json({ ok: false, code: 'invalid_payload', message: 'commentId is required' }, 400, origin);
  }

  const { data: comment, error: commentError } = await supabase
    .from('board_comments')
    .select('id,post_id,author_resident_id,author_role,content')
    .eq('id', commentId)
    .maybeSingle();

  if (commentError) {
    return dbError(commentError, origin);
  }
  if (!comment) {
    return json({ ok: false, code: 'not_found', message: 'comment not found' }, 404, origin);
  }
  if (!isCommentRow(comment) || comment.id !== commentId) {
    return json({ ok: false, code: 'invalid_query_result', message: '댓글 조회 결과를 확인하지 못했습니다.' }, 502, origin);
  }

  const { data: existing, error: existingError } = await supabase
    .from('board_comment_likes')
    .select('id,comment_id,resident_id,role')
    .eq('comment_id', commentId)
    .eq('resident_id', actorCheck.actor.residentId)
    .maybeSingle();

  if (existingError) {
    return dbError(existingError, origin);
  }
  if (
    existing
    && (!isCommentLikeRow(existing)
      || existing.comment_id !== commentId
      || existing.resident_id !== actorCheck.actor.residentId)
  ) {
    return json({ ok: false, code: 'invalid_query_result', message: '댓글 공감 조회 결과를 확인하지 못했습니다.' }, 502, origin);
  }

  let liked = false;
  let notificationStored = true;
  let notificationId: string | null = null;
  if (existing) {
    const { data, error } = await supabase
      .from('board_comment_likes')
      .delete()
      .eq('id', existing.id)
      .eq('comment_id', commentId)
      .eq('resident_id', actorCheck.actor.residentId)
      .select('id,comment_id,resident_id,role')
      .single();
    if (error) {
      return dbError(error, origin);
    }
    if (!isCommentLikeRow(data)) {
      return json({ ok: false, code: 'mutation_receipt_unverified', message: '댓글 공감 취소 결과를 확인하지 못했습니다.' }, 502, origin);
    }
    try {
      requireMutationRowReceipt(data, existing);
    } catch {
      return json({ ok: false, code: 'mutation_receipt_unverified', message: '댓글 공감 취소 결과를 확인하지 못했습니다.' }, 502, origin);
    }
  } else {
    const expectedLike = {
      comment_id: commentId,
      resident_id: actorCheck.actor.residentId,
      role: actorCheck.actor.role,
    };
    const { data, error } = await supabase
      .from('board_comment_likes')
      .insert(expectedLike)
      .select('id,comment_id,resident_id,role')
      .single();
    if (error) {
      return dbError(error, origin);
    }
    if (!isCommentLikeRow(data)) {
      return json({ ok: false, code: 'mutation_receipt_unverified', message: '댓글 공감 저장 결과를 확인하지 못했습니다.' }, 502, origin);
    }
    try {
      requireMutationRowReceipt(data, expectedLike);
    } catch {
      return json({ ok: false, code: 'mutation_receipt_unverified', message: '댓글 공감 저장 결과를 확인하지 못했습니다.' }, 502, origin);
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

  const { count, error: countError } = await supabase
    .from('board_comment_likes')
    .select('id', { count: 'exact', head: true })
    .eq('comment_id', commentId);
  if (countError) {
    return dbError(countError, origin);
  }
  const likeCount = parseQueryCount(count);
  if (likeCount === null) {
    return json({
      ok: false,
      code: 'mutation_result_unverified',
      message: '댓글 공감 수를 확인하지 못했습니다. 목록을 새로고침해주세요.',
      retryable: false,
    }, 502, origin);
  }

  return json({
    ok: true,
    data: {
      commentId,
      residentId: actorCheck.actor.residentId,
      liked,
      likeCount,
    },
    notification: {
      notificationStored,
      pushStatus: 'not_attempted',
      retryable: !notificationStored,
      ...(notificationId ? { notificationId } : {}),
    },
    notificationWarning: notificationStored ? null : 'notification_delivery_incomplete',
  }, 200, origin);
});
