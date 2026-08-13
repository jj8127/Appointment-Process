import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  canActorAccessMessengerAttachmentBatch,
  resolveMessengerAttachmentActor,
} from '../_shared/messenger-attachment-auth.ts';
import {
  MESSENGER_ATTACHMENT_BUCKET,
  normalizeMessengerAttachmentFileDescriptors,
  normalizeMessengerAttachmentSha256,
  normalizeMessengerAttachmentUuid,
} from '../_shared/messenger-attachment-policy.ts';
import {
  createMessengerAttachmentDownload,
  drainMessengerAttachmentCleanup,
  mapMessengerAttachmentRpcError,
  MessengerAttachmentServiceError,
} from '../_shared/messenger-attachment-service.ts';
import { isTrustedFcNotifyServiceKey } from '../_shared/fc-notify-auth-policy.ts';
import { getEnv } from '../_shared/request-board-auth.ts';

const supabaseUrl = getEnv('SUPABASE_URL')?.trim() ?? '';
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
if (!supabaseUrl || !serviceKey) {
  throw new Error('Missing required Supabase service configuration');
}
const supabase = createClient(supabaseUrl, serviceKey);

const allowedOrigins = (getEnv('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const defaultOrigin = allowedOrigins[0] ?? 'https://yourdomain.com';

function isLocalDevelopmentOrigin(origin: string) {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function corsHeaders(origin?: string | null) {
  const safeOrigin = origin && (
      allowedOrigins.includes(origin)
      || isLocalDevelopmentOrigin(origin)
    )
    ? origin
    : defaultOrigin;
  return {
    'Access-Control-Allow-Origin': safeOrigin,
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, x-app-session-token, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Cache-Control': 'no-store',
  };
}

function response(
  body: Record<string, unknown>,
  status = 200,
  origin?: string | null,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function failure(
  code: string,
  message: string,
  status: number,
  origin?: string | null,
) {
  return response({ ok: false, code, message }, status, origin);
}

function userMessageFor(code: string): string {
  if (code === 'attachment_intent_rate_limited' || code === 'attachment_active_quota_exceeded') {
    return '업로드 준비 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
  }
  if (code === 'idempotency_conflict' || code === 'attachment_intent_conflict') {
    return '첨부파일 정보가 이전 요청과 다릅니다. 파일을 다시 선택해주세요.';
  }
  if (code === 'attachment_intent_expired' || code === 'attachment_intent_consumed') {
    return '첨부파일 업로드 시간이 만료되었습니다. 파일을 다시 선택해주세요.';
  }
  if (code === 'forbidden') return '첨부파일을 사용할 권한이 없습니다.';
  if (code.endsWith('_not_found')) return '첨부파일을 찾을 수 없습니다.';
  if (code === 'attachment_storage_unavailable' || code === 'attachment_database_unavailable') {
    return '첨부파일을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
  }
  return '첨부파일 요청을 확인해주세요.';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeContext(value: unknown): Record<string, unknown> | null {
  const context = asRecord(value);
  if (!context) return null;
  if (context.kind === 'direct') {
    const conversationId = normalizeMessengerAttachmentUuid(context.conversationId);
    return conversationId ? { kind: 'direct', conversationId } : null;
  }
  if (context.kind === 'group') {
    const roomId = normalizeMessengerAttachmentUuid(context.roomId);
    return roomId ? { kind: 'group', roomId } : null;
  }
  if (context.kind === 'direct_broadcast') {
    if (
      !Array.isArray(context.conversationIds)
      || context.conversationIds.length < 1
      || context.conversationIds.length > 200
    ) return null;
    const ids = context.conversationIds.map(normalizeMessengerAttachmentUuid);
    if (ids.some((id) => !id)) return null;
    const normalized = ids as string[];
    if (new Set(normalized).size !== normalized.length) return null;
    return {
      kind: 'direct_broadcast',
      conversationIds: [...normalized].sort(),
    };
  }
  return null;
}

async function handleUploadIntentsCreate(
  req: Request,
  body: Record<string, unknown>,
  origin?: string | null,
) {
  const auth = await resolveMessengerAttachmentActor({
    req,
    body,
    supabase,
    serviceKey,
  });
  if (auth.ok === false) return failure(auth.code, auth.message, auth.status, origin);

  const context = normalizeContext(body.context);
  const deliveryKey = normalizeMessengerAttachmentUuid(body.deliveryKey);
  const payloadFingerprint = normalizeMessengerAttachmentSha256(body.payloadFingerprint);
  const files = normalizeMessengerAttachmentFileDescriptors(body.files);
  if (!context || !deliveryKey || !payloadFingerprint || !files) {
    return failure(
      'invalid_attachment_request',
      '첨부파일 정보를 확인해주세요.',
      400,
      origin,
    );
  }

  const { data, error } = await supabase.rpc(
    'reserve_messenger_attachment_upload_batch_v2',
    {
      p_actor_id: auth.actor.id,
      p_actor_role: auth.actor.role,
      p_delivery_key: deliveryKey,
      p_payload_fingerprint: payloadFingerprint,
      p_context: context,
      p_files: files,
    },
  );
  if (error) {
    const mapped = mapMessengerAttachmentRpcError(error);
    return failure(mapped.code, userMessageFor(mapped.code), mapped.status, origin);
  }
  const reservation = asRecord(data);
  if (!reservation) {
    return failure(
      'attachment_database_unavailable',
      userMessageFor('attachment_database_unavailable'),
      503,
      origin,
    );
  }
  if (reservation.state === 'committed') {
    return response({
      ok: true,
      state: 'committed',
      deliveryKey,
      payloadFingerprint,
      expiresAt: null,
      intents: [],
      committed: {
        batchId: reservation.batchId,
        messageIds: Array.isArray(reservation.messageIds) ? reservation.messageIds : [],
      },
    }, 200, origin);
  }

  const rawIntents = Array.isArray(reservation.intents)
    ? reservation.intents as Array<Record<string, unknown>>
    : [];
  if (rawIntents.length !== files.length) {
    return failure(
      'attachment_database_unavailable',
      userMessageFor('attachment_database_unavailable'),
      503,
      origin,
    );
  }

  const signedIntents: Record<string, unknown>[] = [];
  for (const intent of rawIntents) {
    const id = normalizeMessengerAttachmentUuid(intent.id);
    const clientFileId = normalizeMessengerAttachmentUuid(intent.clientFileId);
    const path = typeof intent.path === 'string' ? intent.path : '';
    const order = Number(intent.order);
    if (
      !id
      || !clientFileId
      || !path
      || !Number.isInteger(order)
      || intent.bucket !== MESSENGER_ATTACHMENT_BUCKET
    ) {
      await supabase.rpc('revoke_messenger_attachment_upload_batch_v2', {
        p_actor_id: auth.actor.id,
        p_actor_role: auth.actor.role,
        p_delivery_key: deliveryKey,
        p_reason_code: 'signed_upload_response_invalid',
      });
      return failure(
        'attachment_database_unavailable',
        userMessageFor('attachment_database_unavailable'),
        503,
        origin,
      );
    }
    const { data: signed, error: signedError } = await supabase.storage
      .from(MESSENGER_ATTACHMENT_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (signedError || !signed?.token || !signed?.signedUrl) {
      await supabase.rpc('revoke_messenger_attachment_upload_batch_v2', {
        p_actor_id: auth.actor.id,
        p_actor_role: auth.actor.role,
        p_delivery_key: deliveryKey,
        p_reason_code: 'signed_upload_url_failed',
      });
      return failure(
        'attachment_storage_unavailable',
        userMessageFor('attachment_storage_unavailable'),
        503,
        origin,
      );
    }
    signedIntents.push({
      id,
      clientFileId,
      order,
      upload: {
        bucket: MESSENGER_ATTACHMENT_BUCKET,
        path,
        token: signed.token,
        signedUrl: signed.signedUrl,
      },
    });
  }

  return response({
    ok: true,
    state: 'pending',
    deliveryKey,
    payloadFingerprint,
    expiresAt: reservation.expiresAt,
    intents: signedIntents,
  }, 200, origin);
}

async function handleDownloadUrlCreate(
  req: Request,
  body: Record<string, unknown>,
  origin?: string | null,
) {
  const auth = await resolveMessengerAttachmentActor({
    req,
    body,
    supabase,
    serviceKey,
  });
  if (auth.ok === false) return failure(auth.code, auth.message, auth.status, origin);
  const attachmentId = normalizeMessengerAttachmentUuid(body.attachmentId);
  if (!attachmentId) {
    return failure('invalid_attachment_id', '첨부파일 정보를 확인해주세요.', 400, origin);
  }
  const { data: object, error } = await supabase
    .from('messenger_attachment_objects')
    .select('batch_id,status')
    .eq('id', attachmentId)
    .maybeSingle();
  if (error) {
    return failure(
      'attachment_database_unavailable',
      userMessageFor('attachment_database_unavailable'),
      503,
      origin,
    );
  }
  if (!object?.batch_id || object.status !== 'active') {
    return failure('attachment_not_found', '첨부파일을 찾을 수 없습니다.', 404, origin);
  }
  if (!await canActorAccessMessengerAttachmentBatch({
    supabase,
    actor: auth.actor,
    batchId: object.batch_id,
  })) {
    return failure('attachment_not_found', '첨부파일을 찾을 수 없습니다.', 404, origin);
  }
  try {
    const result = await createMessengerAttachmentDownload({
      supabase,
      attachmentId,
    });
    return response({
      ok: true,
      attachment: result.attachment,
      download: {
        signedUrl: result.signedUrl,
        expiresAt: result.expiresAt,
      },
    }, 200, origin);
  } catch (error) {
    const mapped = error instanceof MessengerAttachmentServiceError
      ? error
      : new MessengerAttachmentServiceError('attachment_storage_unavailable', 503);
    return failure(mapped.code, userMessageFor(mapped.code), mapped.status, origin);
  }
}

async function handleMaintenance(
  req: Request,
  body: Record<string, unknown>,
  origin?: string | null,
) {
  if (!isTrustedFcNotifyServiceKey(req.headers.get('apikey'), serviceKey)) {
    return failure('forbidden', 'Forbidden', 403, origin);
  }
  const limit = Math.max(1, Math.min(Math.floor(Number(body.limit ?? 25)), 100));
  if (body.type === 'cleanup_requeue_exhausted') {
    const { data, error } = await supabase.rpc(
      'requeue_exhausted_messenger_attachment_cleanup_v2',
      { p_limit: limit },
    );
    if (error) {
      return failure(
        'attachment_database_unavailable',
        userMessageFor('attachment_database_unavailable'),
        503,
        origin,
      );
    }
    return response({ ok: true, requeued: Number(data ?? 0) }, 200, origin);
  }
  const { data: expiry, error: expiryError } = await supabase.rpc(
    'expire_messenger_attachment_intents_v2',
    { p_limit: limit },
  );
  if (expiryError) {
    return failure(
      'attachment_database_unavailable',
      userMessageFor('attachment_database_unavailable'),
      503,
      origin,
    );
  }
  const cleanup = await drainMessengerAttachmentCleanup({ supabase, limit });
  const { count: exhausted } = await supabase
    .from('messenger_attachment_cleanup_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'exhausted');
  return response({
    ok: true,
    expired: Number(asRecord(expiry)?.expired ?? 0),
    claimed: cleanup.claimed,
    removed: cleanup.removed,
    requeued: cleanup.requeued,
    exhausted: Number(exhausted ?? cleanup.exhausted),
  }, 200, origin);
}

serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return failure('method_not_allowed', 'Method not allowed', 405, origin);
  }
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await req.json();
    const parsed = asRecord(raw);
    if (!parsed) throw new Error('invalid_json');
    body = parsed;
  } catch {
    return failure('invalid_json', '요청을 확인해주세요.', 400, origin);
  }

  try {
    if (body.type === 'upload_intents_create') {
      return await handleUploadIntentsCreate(req, body, origin);
    }
    if (body.type === 'download_url_create') {
      return await handleDownloadUrlCreate(req, body, origin);
    }
    if (body.type === 'cleanup_drain' || body.type === 'cleanup_requeue_exhausted') {
      return await handleMaintenance(req, body, origin);
    }
    return failure('invalid_type', '요청을 확인해주세요.', 400, origin);
  } catch {
    console.error('[messenger-attachments] request failed', {
      reason: 'unhandled_attachment_request_failure',
    });
    return failure(
      'attachment_service_unavailable',
      '첨부파일을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
      503,
      origin,
    );
  }
});
