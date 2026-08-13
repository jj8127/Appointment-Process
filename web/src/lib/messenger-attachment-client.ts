'use client';

import { supabase } from './supabase';
import {
  MESSENGER_ATTACHMENT_ERROR_COPY,
  validateMessengerAttachmentSelection,
  type MessengerAttachmentMimeType,
} from './messenger-attachment-policy';

export type MessengerAttachmentContext =
  | { kind: 'direct'; conversationId: string }
  | { kind: 'group'; roomId: string }
  | { kind: 'direct_broadcast'; conversationIds: string[] };

export type PreparedMessengerAttachment = {
  clientFileId: string;
  order: number;
  file: File;
  name: string;
  size: number;
  mimeType: MessengerAttachmentMimeType;
  sha256: string;
};

export type PreparedMessengerAttachmentBatch = {
  context: MessengerAttachmentContext;
  deliveryKey: string;
  payloadFingerprint: string;
  files: PreparedMessengerAttachment[];
};

export type MessengerAttachmentMetadata = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
};

type UploadIntent = {
  id: string;
  clientFileId: string;
  order: number;
  upload: {
    bucket: 'messenger-attachments-v2';
    path: string;
    token: string;
    signedUrl: string;
  };
};

type UploadIntentResponse =
  | {
      ok: true;
      state: 'pending';
      deliveryKey: string;
      payloadFingerprint: string;
      expiresAt: string;
      intents: UploadIntent[];
    }
  | {
      ok: true;
      state: 'committed';
      deliveryKey: string;
      payloadFingerprint: string;
      expiresAt: null;
      intents: [];
      committed: {
        batchId: string;
        messageIds: string[];
      };
    };

function isUploadIntent(value: unknown): value is UploadIntent {
  if (!value || typeof value !== 'object') return false;
  const intent = value as Partial<UploadIntent>;
  return typeof intent.id === 'string'
    && typeof intent.clientFileId === 'string'
    && Number.isInteger(intent.order)
    && Boolean(intent.upload)
    && intent.upload?.bucket === 'messenger-attachments-v2'
    && typeof intent.upload.path === 'string'
    && typeof intent.upload.token === 'string'
    && typeof intent.upload.signedUrl === 'string';
}

function isUploadIntentResponse(value: unknown): value is UploadIntentResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as {
    ok?: unknown;
    state?: unknown;
    intents?: unknown;
    committed?: { batchId?: unknown; messageIds?: unknown };
  };
  if (response.ok !== true || !Array.isArray(response.intents)) return false;
  if (response.state === 'pending') {
    return response.intents.every(isUploadIntent);
  }
  return response.state === 'committed'
    && response.intents.length === 0
    && typeof response.committed?.batchId === 'string'
    && Array.isArray(response.committed.messageIds)
    && response.committed.messageIds.every((id) => typeof id === 'string');
}

export type MessengerAttachmentUploadResult =
  | { state: 'uploaded'; intentIds: string[] }
  | { state: 'committed'; messageIds: string[] };

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(bytes: ArrayBuffer) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', bytes));
}

function normalizeAttachmentContext(context: MessengerAttachmentContext): MessengerAttachmentContext {
  if (context.kind === 'direct') {
    return { kind: 'direct', conversationId: context.conversationId.trim().toLowerCase() };
  }
  if (context.kind === 'group') {
    return { kind: 'group', roomId: context.roomId.trim().toLowerCase() };
  }
  return {
    kind: 'direct_broadcast',
    conversationIds: [...new Set(context.conversationIds.map((id) => id.trim().toLowerCase()))]
      .sort(),
  };
}

function normalizeAttachmentContent(content: string) {
  return content.normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

export async function prepareMessengerAttachmentBatch(input: {
  files: readonly File[];
  context: MessengerAttachmentContext;
  content: string;
  deliveryKey?: string;
  clientFileIds?: readonly string[];
}): Promise<PreparedMessengerAttachmentBatch> {
  const validation = validateMessengerAttachmentSelection(input.files);
  if (!validation.ok) throw new Error(validation.error);
  const context = normalizeAttachmentContext(input.context);
  const content = normalizeAttachmentContent(input.content);

  const prepared = await Promise.all(input.files.map(async (file, order) => {
    const metadata = validation.files[order]!;
    return {
      clientFileId: input.clientFileIds?.[order] ?? crypto.randomUUID(),
      order,
      file,
      ...metadata,
      sha256: await sha256Bytes(await file.arrayBuffer()),
    };
  }));
  const fingerprintInput = {
    version: 1,
    context,
    content,
    files: prepared.map(({ clientFileId, order, name, size, mimeType, sha256 }) => ({
      order,
      clientFileId: clientFileId.toLowerCase(),
      name: name.normalize('NFC'),
      size: Math.floor(size),
      mimeType: mimeType.toLowerCase(),
      sha256: sha256.toLowerCase(),
    })),
  };
  return {
    context,
    deliveryKey: input.deliveryKey ?? crypto.randomUUID(),
    payloadFingerprint: await sha256Bytes(
      new TextEncoder().encode(JSON.stringify(fingerprintInput)).buffer,
    ),
    files: prepared,
  };
}

function uploadIntentBody(batch: PreparedMessengerAttachmentBatch) {
  return {
    type: 'upload_intents_create',
    context: batch.context,
    deliveryKey: batch.deliveryKey,
    payloadFingerprint: batch.payloadFingerprint,
    files: batch.files.map(({ clientFileId, name, size, mimeType, sha256 }) => ({
      clientFileId,
      name,
      size,
      mimeType,
      sha256,
    })),
  };
}

async function requestUploadIntents(batch: PreparedMessengerAttachmentBatch) {
  const response = await fetch('/api/messenger-attachments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(uploadIntentBody(batch)),
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (
    !response.ok
    || !isUploadIntentResponse(payload)
    || payload.deliveryKey !== batch.deliveryKey
    || payload.payloadFingerprint !== batch.payloadFingerprint
  ) {
    const errorPayload = payload as {
    code?: string;
    message?: string;
    } | null;
    const error = new Error(
      errorPayload?.message
        ? errorPayload.message
        : MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
    );
    error.name = errorPayload?.code
      ? errorPayload.code
      : 'attachment_intent_failed';
    throw error;
  }
  return payload;
}

function isAlreadyUploadedError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('already exists') || message.includes('duplicate');
}

async function uploadPendingIntents(
  batch: PreparedMessengerAttachmentBatch,
  intents: UploadIntent[],
) {
  const intentClientFileIds = intents.map((intent) => intent.clientFileId);
  if (
    intents.length !== batch.files.length
    || new Set(intentClientFileIds).size !== intentClientFileIds.length
  ) {
    throw new Error(MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed);
  }
  const byClientFileId = new Map(batch.files.map((file) => [file.clientFileId, file]));
  await Promise.all(intents.map(async (intent) => {
    const prepared = byClientFileId.get(intent.clientFileId);
    if (!prepared || intent.upload.bucket !== 'messenger-attachments-v2') {
      throw new Error(MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed);
    }
    const { error } = await supabase.storage
      .from(intent.upload.bucket)
      .uploadToSignedUrl(intent.upload.path, intent.upload.token, prepared.file, {
        contentType: prepared.mimeType,
        upsert: false,
      });
    if (error && !isAlreadyUploadedError(error)) {
      throw new Error(MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed);
    }
  }));
}

export async function uploadMessengerAttachmentBatch(
  batch: PreparedMessengerAttachmentBatch,
): Promise<MessengerAttachmentUploadResult> {
  let response = await requestUploadIntents(batch);
  if (response.state === 'committed') {
    return { state: 'committed', messageIds: response.committed.messageIds };
  }
  try {
    await uploadPendingIntents(batch, response.intents);
  } catch {
    response = await requestUploadIntents(batch);
    if (response.state === 'committed') {
      return { state: 'committed', messageIds: response.committed.messageIds };
    }
    await uploadPendingIntents(batch, response.intents);
  }
  return {
    state: 'uploaded',
    intentIds: [...response.intents]
      .sort((left, right) => left.order - right.order)
      .map((intent) => intent.id),
  };
}

export async function openMessengerAttachment(attachmentId: string) {
  const pendingWindow = window.open('', '_blank');
  if (pendingWindow) pendingWindow.opener = null;
  try {
    const response = await fetch('/api/messenger-attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ type: 'download_url_create', attachmentId }),
    });
    const payload = await response.json().catch(() => null) as {
      ok?: boolean;
      download?: { signedUrl?: string };
      message?: string;
    } | null;
    const signedUrl = typeof payload?.download?.signedUrl === 'string'
      ? payload.download.signedUrl
      : '';
    if (!response.ok || payload?.ok !== true || !signedUrl) {
      throw new Error(payload?.message || MESSENGER_ATTACHMENT_ERROR_COPY.downloadFailed);
    }
    if (pendingWindow) {
      pendingWindow.location.replace(signedUrl);
    } else {
      window.location.assign(signedUrl);
    }
  } catch (error) {
    pendingWindow?.close();
    throw error;
  }
}
