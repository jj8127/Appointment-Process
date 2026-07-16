import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import {
  ATTACHMENT_LIMITS,
  buildCorsHeaders,
  json,
  parseJson,
  requireActor,
  requireRole,
  sanitizeFileName,
  supabase,
} from '../_shared/board.ts';
import { isBoardPostWritableByActor } from '../_shared/board-actor-policy.ts';
import { reportEdgeDiagnostic } from '../_shared/edge-diagnostic.ts';

type FileInput = {
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileType: 'image' | 'file';
};

type Payload = {
  actor?: {
    role: 'admin' | 'manager' | 'fc';
    residentId: string;
    displayName?: string;
  };
  postId?: string;
  files?: FileInput[];
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

  const actorCheck = await requireActor(req, body, 'board-attachment-sign', origin);
  if (actorCheck.ok === false) return actorCheck.response;
  const forbidden = requireRole(actorCheck.actor, ['admin', 'manager'], origin);
  if (forbidden) return forbidden;

  const postId = body.postId;
  const files = body.files ?? [];
  if (!postId || files.length === 0) {
    return json({ ok: false, code: 'invalid_payload', message: 'postId and files required' }, 400, origin);
  }
  if (files.length > ATTACHMENT_LIMITS.maxFiles) {
    return json({ ok: false, code: 'file_limit', message: 'too many files' }, 400, origin);
  }

  const invalidFile = files.some((file) => (
    !file
    || (file.fileType !== 'image' && file.fileType !== 'file')
    || typeof file.fileName !== 'string'
    || !file.fileName.trim()
    || file.fileName.trim().length > 180
    || typeof file.mimeType !== 'string'
    || !file.mimeType.trim()
    || file.mimeType.trim().length > 200
    || !Number.isSafeInteger(file.fileSize)
    || file.fileSize <= 0
  ));
  if (invalidFile) {
    return json({ ok: false, code: 'invalid_file', message: 'invalid attachment metadata' }, 400, origin);
  }

  const totalSize = files.reduce((sum, file) => sum + (file.fileSize ?? 0), 0);
  if (totalSize > ATTACHMENT_LIMITS.maxTotalBytes) {
    return json({ ok: false, code: 'file_total_limit', message: 'total file size exceeded' }, 400, origin);
  }

  for (const file of files) {
    if (file.fileType === 'image' && file.fileSize > ATTACHMENT_LIMITS.maxImageBytes) {
      return json({ ok: false, code: 'file_limit', message: 'image file too large' }, 400, origin);
    }
    if (file.fileType === 'file' && file.fileSize > ATTACHMENT_LIMITS.maxFileBytes) {
      return json({ ok: false, code: 'file_limit', message: 'file too large' }, 400, origin);
    }
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
  if (!isBoardPostWritableByActor(actorCheck.actor, {
    authorRole: post.author_role,
    authorResidentId: post.author_resident_id,
  })) {
    return json({ ok: false, code: 'forbidden', message: 'cannot attach files to this post' }, 403, origin);
  }

  const results: Array<{ storagePath: string; signedUrl: string }> = [];

  for (const file of files) {
    const sanitized = sanitizeFileName(file.fileName.trim());
    const storagePath = `board/${postId}/${crypto.randomUUID()}_${sanitized}`;
    const { data, error } = await supabase.storage
      .from('board-attachments')
      .createSignedUploadUrl(storagePath);
    if (error || !data?.signedUrl) {
      reportEdgeDiagnostic({
        event: 'board_attachment.storage',
        reason: 'signed_upload_url_failed',
        errorClass: 'upstream',
      });
      return json({ ok: false, code: 'storage_error', message: '파일 업로드 URL 생성에 실패했습니다.' }, 500, origin);
    }
    results.push({ storagePath, signedUrl: data.signedUrl });
  }

  return json({ ok: true, data: results }, 200, origin);
});
