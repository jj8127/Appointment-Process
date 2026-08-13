import {
  MAX_MESSENGER_ATTACHMENTS,
  MESSENGER_ATTACHMENT_MIME_BY_EXTENSION,
  validateMessengerAttachmentSelection,
} from './messenger-attachment-policy.ts';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

type Result =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: 400; message: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function uuid(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function sha256(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return SHA256_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeMessengerAttachmentProxyPayload(value: unknown): Result {
  const body = record(value);
  if (!body) return { ok: false, status: 400, message: 'Invalid attachment request' };

  if (body.type === 'download_url_create') {
    const attachmentId = uuid(body.attachmentId);
    return attachmentId
      ? { ok: true, payload: { type: 'download_url_create', attachmentId } }
      : { ok: false, status: 400, message: 'Invalid attachment id' };
  }
  if (body.type !== 'upload_intents_create') {
    return { ok: false, status: 400, message: 'Unsupported attachment action' };
  }

  const context = record(body.context);
  const deliveryKey = uuid(body.deliveryKey);
  const payloadFingerprint = sha256(body.payloadFingerprint);
  if (!context || !deliveryKey || !payloadFingerprint) {
    return { ok: false, status: 400, message: 'Invalid attachment delivery metadata' };
  }

  let normalizedContext: Record<string, unknown> | null = null;
  if (context.kind === 'direct') {
    const conversationId = uuid(context.conversationId);
    if (conversationId) normalizedContext = { kind: 'direct', conversationId };
  } else if (context.kind === 'group') {
    const roomId = uuid(context.roomId);
    if (roomId) normalizedContext = { kind: 'group', roomId };
  } else if (context.kind === 'direct_broadcast' && Array.isArray(context.conversationIds)) {
    const conversationIds = context.conversationIds.map(uuid);
    if (
      conversationIds.length > 0
      && conversationIds.length <= 200
      && conversationIds.every(Boolean)
      && new Set(conversationIds).size === conversationIds.length
    ) {
      normalizedContext = {
        kind: 'direct_broadcast',
        conversationIds: (conversationIds as string[]).sort(),
      };
    }
  }
  if (!normalizedContext) {
    return { ok: false, status: 400, message: 'Invalid attachment context' };
  }

  if (!Array.isArray(body.files) || body.files.length < 1 || body.files.length > MAX_MESSENGER_ATTACHMENTS) {
    return { ok: false, status: 400, message: 'Invalid attachment files' };
  }
  const rawFiles = body.files.map(record);
  if (rawFiles.some((file) => !file)) {
    return { ok: false, status: 400, message: 'Invalid attachment files' };
  }
  const validation = validateMessengerAttachmentSelection(
    rawFiles.map((file) => ({
      name: typeof file?.name === 'string' ? file.name : '',
      size: Number(file?.size),
      type: typeof file?.mimeType === 'string' ? file.mimeType : '',
    })),
  );
  if (!validation.ok) return { ok: false, status: 400, message: validation.error };

  const files = validation.files.map((file, index) => {
    const raw = rawFiles[index]!;
    const clientFileId = uuid(raw.clientFileId);
    const fileSha256 = sha256(raw.sha256);
    if (!clientFileId || !fileSha256) return null;
    return {
      clientFileId,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      sha256: fileSha256,
    };
  });
  if (files.some((file) => !file)) {
    return { ok: false, status: 400, message: 'Invalid attachment file metadata' };
  }
  return {
    ok: true,
    payload: {
      type: 'upload_intents_create',
      context: normalizedContext,
      deliveryKey,
      payloadFingerprint,
      files,
    },
  };
}

export const MESSENGER_ATTACHMENT_ALLOWED_MIME_TYPES =
  new Set(Object.values(MESSENGER_ATTACHMENT_MIME_BY_EXTENSION));
