import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, supabase , dbError } from '../_shared/board.ts';
import {
  type BoardReactionType,
  isBoardActorRole,
  isBoardReactionType,
  isBoardUuid,
} from '../_shared/board-read-contract.ts';
import { requireMutationRowReceipt } from '../_shared/ux-mutation-contract.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  postId?: string;
  reactionType?: 'like' | 'heart' | 'check' | 'smile';
};

type ReactionRow = {
  id: string;
  post_id: string;
  resident_id: string;
  role: 'admin' | 'manager' | 'fc';
  reaction_type: BoardReactionType;
};

function isReactionRow(value: unknown): value is ReactionRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return isBoardUuid(row.id)
    && isBoardUuid(row.post_id)
    && typeof row.resident_id === 'string'
    && row.resident_id.length > 0
    && isBoardActorRole(row.role)
    && isBoardReactionType(row.reaction_type);
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

  const actorCheck = await requireActor(req, body, 'board-reaction-toggle', origin);
  if (actorCheck.ok === false) return actorCheck.response;

  const postId = isBoardUuid(body.postId) ? body.postId.toLowerCase() : null;
  const reactionType = body.reactionType;
  if (!postId || !isBoardReactionType(reactionType)) {
    return json({ ok: false, code: 'invalid_payload', message: 'postId and reactionType required' }, 400, origin);
  }

  const { data: post, error: postError } = await supabase
    .from('board_posts')
    .select('id')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    return dbError(postError, origin);
  }
  if (!post) {
    return json({ ok: false, code: 'not_found', message: 'post not found' }, 404, origin);
  }
  if (!isBoardUuid(post.id) || post.id !== postId) {
    return json({ ok: false, code: 'invalid_query_result', message: '게시글 조회 결과를 확인하지 못했습니다.' }, 502, origin);
  }

  const { data: existing, error: existingError } = await supabase
    .from('board_post_reactions')
    .select('id,post_id,resident_id,role,reaction_type')
    .eq('post_id', postId)
    .eq('resident_id', actorCheck.actor.residentId)
    .maybeSingle();

  if (existingError) {
    return dbError(existingError, origin);
  }
  if (
    existing
    && (!isReactionRow(existing)
      || existing.post_id !== postId
      || existing.resident_id !== actorCheck.actor.residentId)
  ) {
    return json({ ok: false, code: 'invalid_query_result', message: '반응 조회 결과를 확인하지 못했습니다.' }, 502, origin);
  }

  let myReaction: Payload['reactionType'] | null = null;
  if (!existing) {
    const expected = {
      post_id: postId,
      resident_id: actorCheck.actor.residentId,
      role: actorCheck.actor.role,
      reaction_type: reactionType,
    };
    const { data, error } = await supabase
      .from('board_post_reactions')
      .insert(expected)
      .select('id,post_id,resident_id,role,reaction_type')
      .single();
    if (error) {
      return dbError(error, origin);
    }
    if (!isReactionRow(data)) {
      return json({ ok: false, code: 'mutation_receipt_unverified', message: '반응 저장 결과를 확인하지 못했습니다.' }, 502, origin);
    }
    try {
      requireMutationRowReceipt(data, expected);
    } catch {
      return json({ ok: false, code: 'mutation_receipt_unverified', message: '반응 저장 결과를 확인하지 못했습니다.' }, 502, origin);
    }
    myReaction = reactionType;
  } else if (existing.reaction_type === reactionType) {
    const { data, error } = await supabase
      .from('board_post_reactions')
      .delete()
      .eq('id', existing.id)
      .eq('post_id', postId)
      .eq('resident_id', actorCheck.actor.residentId)
      .eq('reaction_type', existing.reaction_type)
      .select('id,post_id,resident_id,role,reaction_type')
      .single();
    if (error) {
      return dbError(error, origin);
    }
    if (!isReactionRow(data)) {
      return json({ ok: false, code: 'mutation_receipt_unverified', message: '반응 삭제 결과를 확인하지 못했습니다.' }, 502, origin);
    }
    try {
      requireMutationRowReceipt(data, existing);
    } catch {
      return json({ ok: false, code: 'mutation_receipt_unverified', message: '반응 삭제 결과를 확인하지 못했습니다.' }, 502, origin);
    }
    myReaction = null;
  } else {
    const { data, error } = await supabase
      .from('board_post_reactions')
      .update({ reaction_type: reactionType })
      .eq('id', existing.id)
      .eq('post_id', postId)
      .eq('resident_id', actorCheck.actor.residentId)
      .eq('reaction_type', existing.reaction_type)
      .select('id,post_id,resident_id,role,reaction_type')
      .single();
    if (error) {
      return dbError(error, origin);
    }
    if (!isReactionRow(data)) {
      return json({ ok: false, code: 'mutation_receipt_unverified', message: '반응 저장 결과를 확인하지 못했습니다.' }, 502, origin);
    }
    try {
      requireMutationRowReceipt(data, { ...existing, reaction_type: reactionType });
    } catch {
      return json({ ok: false, code: 'mutation_receipt_unverified', message: '반응 저장 결과를 확인하지 못했습니다.' }, 502, origin);
    }
    myReaction = reactionType;
  }

  return json({
    ok: true,
    data: {
      postId,
      residentId: actorCheck.actor.residentId,
      myReaction,
    },
  }, 200, origin);
});
