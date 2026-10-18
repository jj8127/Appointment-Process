import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, requireRole, supabase , dbError } from '../_shared/board.ts';
import { isBoardUuid } from '../_shared/board-read-contract.ts';
import { requireMutationRowReceipt } from '../_shared/ux-mutation-contract.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  postId?: string;
  isPinned?: boolean;
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

  const actorCheck = await requireActor(req, body, 'board-pin', origin);
  if (actorCheck.ok === false) return actorCheck.response;
  const forbidden = requireRole(actorCheck.actor, ['admin'], origin);
  if (forbidden) return forbidden;

  const postId = isBoardUuid(body.postId) ? body.postId.toLowerCase() : null;
  if (!postId || typeof body.isPinned !== 'boolean') {
    return json({ ok: false, code: 'invalid_payload', message: 'postId and isPinned required' }, 400, origin);
  }

  const payload = {
    is_pinned: body.isPinned,
    pinned_at: body.isPinned ? new Date().toISOString() : null,
    pinned_by_resident_id: body.isPinned ? actorCheck.actor.residentId : null,
  };

  const { data, error } = await supabase
    .from('board_posts')
    .update(payload)
    .eq('id', postId)
    .select('id,is_pinned,pinned_at,pinned_by_resident_id')
    .single();

  if (error) {
    return dbError(error, origin);
  }
  try {
    requireMutationRowReceipt(data, { id: postId, ...payload });
  } catch {
    return json({
      ok: false,
      code: 'mutation_receipt_unverified',
      message: '고정 상태 저장 결과를 확인하지 못했습니다.',
    }, 502, origin);
  }

  return json({
    ok: true,
    data: {
      postId: data.id,
      isPinned: data.is_pinned,
      pinnedAt: data.pinned_at,
      pinnedByResidentId: data.pinned_by_resident_id,
    },
  }, 200, origin);
});
