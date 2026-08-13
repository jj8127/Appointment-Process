import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import {
  inspectMessengerAttachment,
  MESSENGER_ATTACHMENT_DOWNLOAD_TTL_SECONDS,
  normalizeMessengerAttachmentIntentIds,
  normalizeMessengerAttachmentSha256,
  normalizeMessengerAttachmentUuid,
  type InspectedMessengerAttachment,
} from './messenger-attachment-policy.ts';

export class MessengerAttachmentServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = 'MessengerAttachmentServiceError';
  }
}

type AttachmentActor = {
  id: string;
  role: 'fc' | 'admin' | 'manager';
};

type UploadIntentRow = {
  id: string;
  batch_id: string;
  generation: number;
  client_file_id: string;
  sort_order: number;
  original_name: string;
  declared_mime_type: string;
  expected_size: number;
  expected_sha256: string;
  bucket_id: string;
  object_path: string | null;
  status: string;
  expires_at: string;
};

type DeliveryBatchRow = {
  id: string;
  generation: number;
  status: string;
  expires_at: string;
  payload_fingerprint: string;
  committed_message_ids: string[] | null;
};

export type MessengerAttachmentMetadata = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
};

function cleanStorageErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'storage_operation_failed';
  const status = Number((error as { status?: unknown; statusCode?: unknown }).status
    ?? (error as { statusCode?: unknown }).statusCode);
  if (status === 404) return 'storage_object_missing';
  if (status === 409) return 'storage_object_conflict';
  if (status === 429) return 'storage_rate_limited';
  return 'storage_operation_failed';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function finalizeMessengerAttachmentBatch(input: {
  supabase: SupabaseClient;
  actor: AttachmentActor;
  deliveryKey: string;
  payloadFingerprint: string;
  intentIds: unknown;
}): Promise<{
  batchId: string;
  replayed: boolean;
  committedMessageIds: string[];
  inspections: Array<{ id: string } & InspectedMessengerAttachment>;
}> {
  const deliveryKey = normalizeMessengerAttachmentUuid(input.deliveryKey);
  const payloadFingerprint = normalizeMessengerAttachmentSha256(input.payloadFingerprint);
  const intentIds = normalizeMessengerAttachmentIntentIds(input.intentIds);
  if (!deliveryKey || !payloadFingerprint || !intentIds || intentIds.length < 1) {
    throw new MessengerAttachmentServiceError('invalid_attachment_intent_reference', 400);
  }

  const { data: batchData, error: batchError } = await input.supabase
    .from('messenger_attachment_delivery_batches')
    .select('id,generation,status,expires_at,payload_fingerprint,committed_message_ids')
    .eq('actor_id', input.actor.id)
    .eq('actor_role', input.actor.role)
    .eq('delivery_key', deliveryKey)
    .maybeSingle();
  if (batchError) {
    throw new MessengerAttachmentServiceError('attachment_database_unavailable', 503);
  }
  const batch = batchData as DeliveryBatchRow | null;
  if (!batch?.id) {
    throw new MessengerAttachmentServiceError('attachment_intent_not_found', 404);
  }
  if (batch.payload_fingerprint !== payloadFingerprint) {
    throw new MessengerAttachmentServiceError('idempotency_conflict', 409);
  }
  if (batch.status === 'committed') {
    return {
      batchId: batch.id,
      replayed: true,
      committedMessageIds: Array.isArray(batch.committed_message_ids)
        ? batch.committed_message_ids
        : [],
      inspections: [],
    };
  }
  if (batch.status !== 'pending') {
    throw new MessengerAttachmentServiceError('attachment_intent_consumed', 410);
  }
  if (Date.parse(batch.expires_at) <= Date.now()) {
    throw new MessengerAttachmentServiceError('attachment_intent_expired', 410);
  }

  const { data: rawIntents, error: intentError } = await input.supabase
    .from('messenger_attachment_upload_intents')
    .select(
      'id,batch_id,generation,client_file_id,sort_order,original_name,declared_mime_type,'
      + 'expected_size,expected_sha256,bucket_id,object_path,status,expires_at',
    )
    .eq('batch_id', batch.id)
    .eq('generation', batch.generation)
    .in('id', intentIds)
    .order('sort_order', { ascending: true });
  if (intentError) {
    throw new MessengerAttachmentServiceError('attachment_database_unavailable', 503);
  }
  const intents = (rawIntents ?? []) as unknown as UploadIntentRow[];
  if (
    intents.length !== intentIds.length
    || intents.some((intent, index) =>
      intent.id !== intentIds[index]
      || !intent.object_path
      || !['pending', 'validated'].includes(intent.status)
      || Date.parse(intent.expires_at) <= Date.now()
    )
  ) {
    throw new MessengerAttachmentServiceError('attachment_intent_conflict', 409);
  }

  const inspections: Array<{ id: string } & InspectedMessengerAttachment> = [];
  for (const intent of intents) {
    const { data: blob, error: downloadError } = await input.supabase.storage
      .from(intent.bucket_id)
      .download(intent.object_path!);
    if (downloadError || !blob) {
      throw new MessengerAttachmentServiceError(
        cleanStorageErrorCode(downloadError) === 'storage_object_missing'
          ? 'attachment_object_missing'
          : 'attachment_storage_unavailable',
        cleanStorageErrorCode(downloadError) === 'storage_object_missing' ? 409 : 503,
      );
    }
    if (
      blob.type
      && blob.type !== 'application/octet-stream'
      && blob.type.toLowerCase() !== intent.declared_mime_type
    ) {
      throw new MessengerAttachmentServiceError('invalid_attachment_mime', 400);
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await blob.arrayBuffer());
    } catch {
      throw new MessengerAttachmentServiceError('attachment_storage_unavailable', 503);
    }
    try {
      const inspected = await inspectMessengerAttachment({
        name: intent.original_name,
        declaredMimeType: intent.declared_mime_type,
        expectedSize: Number(intent.expected_size),
        expectedSha256: intent.expected_sha256,
        bytes,
      });
      inspections.push({ id: intent.id, ...inspected });
    } catch (error) {
      const code = error instanceof Error && /^invalid_attachment_/.test(error.message)
        ? error.message
        : 'invalid_attachment_content';
      throw new MessengerAttachmentServiceError(code, 400);
    }
  }

  const { data: validationData, error: validationError } = await input.supabase.rpc(
    'validate_messenger_attachment_intents_v2',
    {
      p_actor_id: input.actor.id,
      p_actor_role: input.actor.role,
      p_delivery_key: deliveryKey,
      p_payload_fingerprint: payloadFingerprint,
      p_intents: inspections.map((inspection) => ({
        id: inspection.id,
        family: inspection.family,
        mimeType: inspection.mimeType,
        size: inspection.size,
        sha256: inspection.sha256,
      })),
    },
  );
  if (validationError) {
    const message = String(validationError.message ?? '');
    if (message.includes('attachment_intent_expired')) {
      throw new MessengerAttachmentServiceError('attachment_intent_expired', 410);
    }
    if (message.includes('attachment_idempotency_conflict')) {
      throw new MessengerAttachmentServiceError('idempotency_conflict', 409);
    }
    if (
      message.includes('attachment_intent_set_mismatch')
      || message.includes('attachment_intent_validation_mismatch')
    ) {
      throw new MessengerAttachmentServiceError('attachment_intent_conflict', 409);
    }
    throw new MessengerAttachmentServiceError('attachment_database_unavailable', 503);
  }
  const validation = asRecord(validationData);
  if (!validation) {
    throw new MessengerAttachmentServiceError('attachment_database_unavailable', 503);
  }
  if (validation.state === 'committed') {
    return {
      batchId: String(validation.batchId ?? batch.id),
      replayed: true,
      committedMessageIds: Array.isArray(validation.messageIds)
        ? validation.messageIds.filter((id): id is string => typeof id === 'string')
        : [],
      inspections: [],
    };
  }
  return {
    batchId: batch.id,
    replayed: false,
    committedMessageIds: [],
    inspections,
  };
}

export async function listMessengerAttachmentsByBatchIds(input: {
  supabase: SupabaseClient;
  batchIds: Array<string | null | undefined>;
}): Promise<Map<string, MessengerAttachmentMetadata[]>> {
  const batchIds = Array.from(new Set(
    input.batchIds
      .map(normalizeMessengerAttachmentUuid)
      .filter((id): id is string => Boolean(id)),
  ));
  const result = new Map<string, MessengerAttachmentMetadata[]>();
  if (batchIds.length === 0) return result;
  const { data, error } = await input.supabase
    .from('messenger_attachment_objects')
    .select('id,batch_id,sort_order,original_name,mime_type,byte_size,sha256,status')
    .in('batch_id', batchIds)
    .order('sort_order', { ascending: true });
  if (error) {
    throw new MessengerAttachmentServiceError('attachment_database_unavailable', 503);
  }
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const batchId = String(row.batch_id ?? '');
    if (!batchId || row.status !== 'active') continue;
    const attachments = result.get(batchId) ?? [];
    attachments.push({
      id: String(row.id),
      name: String(row.original_name),
      size: Number(row.byte_size),
      mimeType: String(row.mime_type),
      sha256: String(row.sha256),
    });
    result.set(batchId, attachments);
  }
  return result;
}

export async function createMessengerAttachmentDownload(input: {
  supabase: SupabaseClient;
  attachmentId: string;
}): Promise<{
  attachment: MessengerAttachmentMetadata;
  signedUrl: string;
  expiresAt: string;
  batchId: string;
}> {
  const attachmentId = normalizeMessengerAttachmentUuid(input.attachmentId);
  if (!attachmentId) {
    throw new MessengerAttachmentServiceError('invalid_attachment_id', 400);
  }
  const { data, error } = await input.supabase
    .from('messenger_attachment_objects')
    .select('id,batch_id,original_name,mime_type,byte_size,sha256,bucket_id,storage_path,status')
    .eq('id', attachmentId)
    .maybeSingle();
  if (error) {
    throw new MessengerAttachmentServiceError('attachment_database_unavailable', 503);
  }
  const row = data as Record<string, unknown> | null;
  if (
    !row?.id
    || row.status !== 'active'
    || typeof row.bucket_id !== 'string'
    || typeof row.storage_path !== 'string'
  ) {
    throw new MessengerAttachmentServiceError('attachment_not_found', 404);
  }
  const { data: signed, error: signedError } = await input.supabase.storage
    .from(row.bucket_id)
    .createSignedUrl(row.storage_path, MESSENGER_ATTACHMENT_DOWNLOAD_TTL_SECONDS, {
      download: String(row.original_name),
    });
  if (signedError || !signed?.signedUrl) {
    throw new MessengerAttachmentServiceError('attachment_storage_unavailable', 503);
  }
  return {
    attachment: {
      id: String(row.id),
      name: String(row.original_name),
      size: Number(row.byte_size),
      mimeType: String(row.mime_type),
      sha256: String(row.sha256),
    },
    signedUrl: signed.signedUrl,
    expiresAt: new Date(
      Date.now() + MESSENGER_ATTACHMENT_DOWNLOAD_TTL_SECONDS * 1000,
    ).toISOString(),
    batchId: String(row.batch_id),
  };
}

export async function drainMessengerAttachmentCleanup(input: {
  supabase: SupabaseClient;
  limit?: number;
  batchId?: string | null;
}): Promise<{
  claimed: number;
  removed: number;
  requeued: number;
  exhausted: number;
}> {
  const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 25), 100));
  const batchId = input.batchId ? normalizeMessengerAttachmentUuid(input.batchId) : null;
  const { data, error } = await input.supabase.rpc(
    'claim_messenger_attachment_cleanup_v2',
    { p_limit: limit, p_batch_id: batchId },
  );
  if (error) {
    return { claimed: 0, removed: 0, requeued: 0, exhausted: 0 };
  }
  const jobs = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  let removed = 0;
  let requeued = 0;
  let exhausted = 0;
  for (const job of jobs) {
    const jobId = normalizeMessengerAttachmentUuid(job.job_id);
    const bucket = typeof job.bucket_id === 'string' ? job.bucket_id : '';
    const path = typeof job.storage_path === 'string' ? job.storage_path : '';
    if (!jobId || !bucket || !path) continue;
    const removal = await input.supabase.storage.from(bucket).remove([path]);
    const completion = await input.supabase.rpc(
      'complete_messenger_attachment_cleanup_v2',
      {
        p_job_id: jobId,
        p_removed: !removal.error,
        p_error_code: removal.error ? cleanStorageErrorCode(removal.error) : null,
      },
    );
    const status = asRecord(completion.data)?.status;
    if (!removal.error && status === 'completed') removed += 1;
    else if (status === 'exhausted') exhausted += 1;
    else requeued += 1;
  }
  return { claimed: jobs.length, removed, requeued, exhausted };
}

export function mapMessengerAttachmentRpcError(error: unknown): MessengerAttachmentServiceError {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : '';
  const mappings: Array<[string, string, number]> = [
    ['attachment_intent_rate_limited', 'attachment_intent_rate_limited', 429],
    ['attachment_active_quota_exceeded', 'attachment_active_quota_exceeded', 429],
    ['attachment_idempotency_conflict', 'idempotency_conflict', 409],
    ['attachment_intent_set_mismatch', 'attachment_intent_conflict', 409],
    ['attachment_intent_validation_mismatch', 'attachment_intent_conflict', 409],
    ['attachment_intent_consumed', 'attachment_intent_consumed', 410],
    ['attachment_intent_expired', 'attachment_intent_expired', 410],
    ['attachment_context_forbidden', 'forbidden', 403],
    ['attachment_actor_not_active', 'forbidden', 403],
    ['attachment_context_not_found', 'context_not_found', 404],
    ['attachment_intent_not_found', 'attachment_intent_not_found', 404],
    ['attachment_message_not_found', 'attachment_message_not_found', 404],
    ['invalid_attachment', 'invalid_attachment_request', 400],
  ];
  for (const [needle, code, status] of mappings) {
    if (message.includes(needle)) return new MessengerAttachmentServiceError(code, status);
  }
  return new MessengerAttachmentServiceError('attachment_database_unavailable', 503);
}
