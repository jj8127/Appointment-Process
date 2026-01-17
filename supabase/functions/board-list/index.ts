import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { buildCorsHeaders, json, parseJson, previewContent, requireActor, supabase } from '../_shared/board.ts';

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  categoryId?: string;
  search?: string;
  sort?: 'created' | 'latest' | 'comments' | 'reactions';
  order?: 'asc' | 'desc';
  cursor?: string;
  limit?: number;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

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

  const sort = body.sort ?? 'created';
  const order = body.order ?? 'desc';
  const limit = Math.min(Math.max(body.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursor = body.cursor;
  const categoryId = body.categoryId;
  const search = (body.search ?? '').trim();

  const baseSelect =
    'id,category_id,title,content,author_name,author_role,author_resident_id,created_at,updated_at,edited_at,is_pinned,pinned_at,comment_count,reaction_count,attachment_count,search_vector';

  const sortField = sort === 'latest' ? 'updated_at' : 'created_at';
  const ascending = order === 'asc';

  const applyFilters = (query: any) => {
    if (categoryId) query = query.eq('category_id', categoryId);
    if (search) query = query.textSearch('search_vector', search, { type: 'plain' });
    return query;
  };

  let pinnedQuery = supabase
    .from('board_posts_with_stats')
    .select(baseSelect)
    .eq('is_pinned', true)
    .order('pinned_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10);

  pinnedQuery = applyFilters(pinnedQuery);

  let listQuery = supabase
    .from('board_posts_with_stats')
    .select(baseSelect)
    .eq('is_pinned', false);

  listQuery = applyFilters(listQuery);

  if (sort === 'comments') {
    listQuery = listQuery.order('comment_count', { ascending });
    listQuery = listQuery.order('created_at', { ascending: false });
  } else if (sort === 'reactions') {
    listQuery = listQuery.order('reaction_count', { ascending });
    listQuery = listQuery.order('created_at', { ascending: false });
  } else {
    if (cursor) {
      listQuery = listQuery[ascending ? 'gt' : 'lt'](sortField, cursor);
    }
    listQuery = listQuery.order(sortField, { ascending });
  }

  listQuery = listQuery.limit(limit);

  const [pinnedResult, listResult] = await Promise.all([pinnedQuery, listQuery]);

  if (pinnedResult.error) {
    return json({ ok: false, code: 'db_error', message: pinnedResult.error.message }, 500, origin);
  }
  if (listResult.error) {
    return json({ ok: false, code: 'db_error', message: listResult.error.message }, 500, origin);
  }

  const normalize = (row: any) => ({
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    contentPreview: previewContent(row.content),
    authorName: row.author_name,
    authorRole: row.author_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    editedAt: row.edited_at ?? undefined,
    isPinned: row.is_pinned,
    isMine: row.author_resident_id === actorCheck.actor.residentId,
    stats: {
      commentCount: row.comment_count ?? 0,
      reactionCount: row.reaction_count ?? 0,
      attachmentCount: row.attachment_count ?? 0,
    },
  });

  const pinnedItems = (pinnedResult.data ?? []).map(normalize);
  const items = (listResult.data ?? []).map(normalize);

  const postIds = Array.from(new Set([...pinnedItems, ...items].map((item) => item.id)));
  const reactionMap = new Map<string, { like: number; heart: number; check: number; smile: number }>();
  const attachmentMap = new Map<
    string,
    Array<{
      id: string;
      fileType: 'image' | 'file';
      fileName: string;
      fileSize: number;
      storagePath: string;
      signedUrl?: string;
    }>
  >();

  if (postIds.length > 0) {
    const [reactionsRes, attachmentsRes] = await Promise.all([
      supabase
        .from('board_post_reactions')
        .select('post_id,reaction_type')
        .in('post_id', postIds),
      supabase
        .from('board_attachments')
        .select('id,post_id,file_type,file_name,file_size,storage_path')
        .in('post_id', postIds),
    ]);

    if (reactionsRes.error) {
      return json({ ok: false, code: 'db_error', message: reactionsRes.error.message }, 500, origin);
    }
    if (attachmentsRes.error) {
      return json({ ok: false, code: 'db_error', message: attachmentsRes.error.message }, 500, origin);
    }

    (reactionsRes.data ?? []).forEach((row) => {
      const key = row.post_id;
      const current = reactionMap.get(key) ?? { like: 0, heart: 0, check: 0, smile: 0 };
      if (row.reaction_type === 'like') current.like += 1;
      if (row.reaction_type === 'heart') current.heart += 1;
      if (row.reaction_type === 'check') current.check += 1;
      if (row.reaction_type === 'smile') current.smile += 1;
      reactionMap.set(key, current);
    });

    const signedUrlMap = new Map<string, string>();
    const imageCounts = new Map<string, number>();
    for (const row of attachmentsRes.data ?? []) {
      if (row.file_type !== 'image') continue;
      const current = imageCounts.get(row.post_id) ?? 0;
      if (current >= 3) continue;
      imageCounts.set(row.post_id, current + 1);
      const { data, error } = await supabase.storage
        .from('board-attachments')
        .createSignedUrl(row.storage_path, 60 * 60);
      if (!error && data?.signedUrl) {
        signedUrlMap.set(row.id, data.signedUrl);
      }
    }

    (attachmentsRes.data ?? []).forEach((row) => {
      const list = attachmentMap.get(row.post_id) ?? [];
      list.push({
        id: row.id,
        fileType: row.file_type,
        fileName: row.file_name,
        fileSize: row.file_size,
        storagePath: row.storage_path,
        signedUrl: row.file_type === 'image' ? signedUrlMap.get(row.id) : undefined,
      });
      attachmentMap.set(row.post_id, list);
    });
  }

  const withExtras = (item: ReturnType<typeof normalize>) => ({
    ...item,
    reactions: reactionMap.get(item.id) ?? { like: 0, heart: 0, check: 0, smile: 0 },
    attachments: attachmentMap.get(item.id) ?? [],
  });

  const enrichedPinned = pinnedItems.map(withExtras);
  const enrichedItems = items.map(withExtras);

  const nextCursor = sort === 'comments' || sort === 'reactions'
    ? null
    : items.length === limit
      ? items[items.length - 1][sortField === 'updated_at' ? 'updatedAt' : 'createdAt']
      : null;

  return json({
    ok: true,
    data: {
      items: [...enrichedPinned, ...enrichedItems],
      nextCursor,
    },
  }, 200, origin);
});
