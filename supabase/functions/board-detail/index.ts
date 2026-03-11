import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  buildCorsHeaders,
  json,
  parseJson,
  requireActor,
  supabase,
  dbError,
  resolveDeveloperResidentIds,
  toBoardDisplayRole,
} from '../_shared/board.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  postId?: string;
};

const REACTION_TYPES = ['like', 'heart', 'check', 'smile'] as const;

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
  if (!postId) return json({ ok: false, code: 'invalid_payload', message: 'postId is required' }, 400, origin);

  // 조회수 집계: 상세 조회 호출마다 1건 누적
  const { error: viewTrackError } = await supabase
    .from('board_post_views')
    .insert({
      post_id: postId,
      resident_id: actorCheck.actor.residentId,
      role: actorCheck.actor.role,
    });

  if (viewTrackError) {
    // 조회수 기록 실패가 상세 조회 전체 실패로 이어지지 않도록 경고만 남기고 진행
    console.warn('[board-detail] view track failed', viewTrackError.message);
  }

  const { data: post, error: postError } = await supabase
    .from('board_posts_with_stats')
    .select('id,category_id,title,content,author_name,author_role,author_resident_id,created_at,updated_at,edited_at,is_pinned,view_count')
    .eq('id', postId)
    .maybeSingle();

  if (postError) {
    return json({ ok: false, code: 'db_error', message: postError.message }, 500, origin);
  }
  if (!post) {
    return json({ ok: false, code: 'not_found', message: 'post not found' }, 404, origin);
  }

  const [attachmentsRes, reactionsRes, commentsRes, likesRes] = await Promise.all([
    supabase
      .from('board_attachments')
      .select('id,file_type,file_name,file_size,mime_type,storage_path,sort_order')
      .eq('post_id', postId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('board_post_reactions')
      .select('resident_id,reaction_type')
      .eq('post_id', postId),
    supabase
      .from('board_comments_with_stats')
      .select('id,parent_id,content,author_name,author_role,author_resident_id,created_at,edited_at,like_count,reply_count')
      .eq('post_id', postId)
      .order('created_at', { ascending: true }),
    supabase
      .from('board_comment_likes')
      .select('comment_id,resident_id')
      .eq('resident_id', actorCheck.actor.residentId),
  ]);

  if (attachmentsRes.error) {
    return dbError(attachmentsRes.error, origin);
  }
  if (reactionsRes.error) {
    return dbError(reactionsRes.error, origin);
  }
  if (commentsRes.error) {
    return dbError(commentsRes.error, origin);
  }
  if (likesRes.error) {
    return dbError(likesRes.error, origin);
  }

  const developerResidentIds = await resolveDeveloperResidentIds([
    { author_role: post.author_role, author_resident_id: post.author_resident_id },
    ...((commentsRes.data ?? []).map((row) => ({
      author_role: row.author_role,
      author_resident_id: row.author_resident_id,
    }))),
  ]);

  const reactions = {
    like: 0,
    heart: 0,
    check: 0,
    smile: 0,
    myReaction: null as (typeof REACTION_TYPES)[number] | null,
  };

  (reactionsRes.data ?? []).forEach((row) => {
    const type = row.reaction_type as (typeof REACTION_TYPES)[number];
    if (REACTION_TYPES.includes(type)) {
      reactions[type] += 1;
      if (row.resident_id === actorCheck.actor.residentId) {
        reactions.myReaction = type;
      }
    }
  });

  const likedCommentIds = new Set((likesRes.data ?? []).map((row) => row.comment_id));

  const comments = (commentsRes.data ?? []).map((row) => ({
    id: row.id,
    parentId: row.parent_id ?? null,
    content: row.content,
    authorName: row.author_name,
    authorRole: toBoardDisplayRole(row.author_role, row.author_resident_id, developerResidentIds),
    createdAt: row.created_at,
    editedAt: row.edited_at ?? undefined,
    stats: {
      likeCount: row.like_count ?? 0,
      replyCount: row.reply_count ?? 0,
    },
    isMine: row.author_resident_id === actorCheck.actor.residentId,
    isLiked: likedCommentIds.has(row.id),
  }));

  const attachments = await Promise.all(
    (attachmentsRes.data ?? []).map(async (row) => {
      const signed = await supabase.storage
        .from('board-attachments')
        .createSignedUrl(row.storage_path, 60 * 60);
      return {
        id: row.id,
        fileType: row.file_type,
        fileName: row.file_name,
        fileSize: row.file_size,
        mimeType: row.mime_type ?? undefined,
        storagePath: row.storage_path,
        signedUrl: signed.data?.signedUrl ?? undefined,
      };
    }),
  );

  return json({
    ok: true,
    data: {
      post: {
        id: post.id,
        categoryId: post.category_id,
        title: post.title,
        content: post.content,
        authorName: post.author_name,
        authorRole: toBoardDisplayRole(post.author_role, post.author_resident_id, developerResidentIds),
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        editedAt: post.edited_at ?? undefined,
        isPinned: post.is_pinned,
        isMine: post.author_resident_id === actorCheck.actor.residentId,
        viewCount: post.view_count ?? 0,
      },
      attachments,
      reactions,
      comments,
    },
  }, 200, origin);
});
