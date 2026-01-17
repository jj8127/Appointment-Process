import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, requireActor, supabase } from '../_shared/board.ts';

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

  const { data: post, error: postError } = await supabase
    .from('board_posts')
    .select('id,category_id,title,content,author_name,author_role,author_resident_id,created_at,updated_at,edited_at,is_pinned')
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
      .select('id,file_type,file_name,file_size,mime_type,storage_path')
      .eq('post_id', postId)
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
    return json({ ok: false, code: 'db_error', message: attachmentsRes.error.message }, 500, origin);
  }
  if (reactionsRes.error) {
    return json({ ok: false, code: 'db_error', message: reactionsRes.error.message }, 500, origin);
  }
  if (commentsRes.error) {
    return json({ ok: false, code: 'db_error', message: commentsRes.error.message }, 500, origin);
  }
  if (likesRes.error) {
    return json({ ok: false, code: 'db_error', message: likesRes.error.message }, 500, origin);
  }

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
    authorRole: row.author_role,
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
        authorRole: post.author_role,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        editedAt: post.edited_at ?? undefined,
        isPinned: post.is_pinned,
        isMine: post.author_resident_id === actorCheck.actor.residentId,
      },
      attachments,
      reactions,
      comments,
    },
  }, 200, origin);
});
