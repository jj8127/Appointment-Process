import {
  CryptoDigestAlgorithm,
  digest,
  digestStringAsync,
  randomUUID,
} from 'expo-crypto';
import { File as ExpoFile } from 'expo-file-system';

import {
  cleanMessengerAttachmentName,
  getMessengerAttachmentMimeType,
  MAX_MESSENGER_ATTACHMENT_BYTES,
  MAX_MESSENGER_ATTACHMENTS,
  normalizeMessengerAttachmentContent,
  parseMessengerAttachmentMetadataList,
  type MessengerAttachmentMimeType,
} from './messenger-attachment-contract';
import { isNotificationUuid } from './notification-target';
import { getStoredAppSessionToken } from './request-board-api';
import { supabase } from './supabase';

export {
  MAX_MESSENGER_ATTACHMENT_BYTES,
  MAX_MESSENGER_ATTACHMENTS,
  MESSENGER_ATTACHMENT_MIME_BY_EXTENSION,
  normalizeMessengerAttachmentContent,
  parseMessengerAttachmentMetadataList,
  type MessengerAttachmentMetadata,
  type MessengerAttachmentMimeType,
} from './messenger-attachment-contract';

export const MESSENGER_ATTACHMENT_FUNCTION = 'messenger-attachments';
export const MESSENGER_ATTACHMENT_BUCKET = 'messenger-attachments-v2';

export const MESSENGER_ATTACHMENT_ERROR_COPY = {
  tooMany: '파일은 메시지당 최대 10개까지 첨부할 수 있습니다.',
  tooLarge: '파일은 각각 최대 20MiB까지 첨부할 수 있습니다.',
  unsupported:
    '지원하지 않는 파일 형식입니다. 이미지, PDF, Word, Excel, PowerPoint, TXT 파일만 첨부할 수 있습니다.',
  readFailed: '선택한 파일을 읽지 못했습니다. 다시 선택해 주세요.',
  uploadFailed: '파일을 업로드하지 못했습니다. 다시 시도해 주세요.',
  downloadFailed: '파일을 열지 못했습니다. 다시 시도해 주세요.',
  missingSession: '세션이 만료되었습니다. 다시 로그인해 주세요.',
} as const;

export type MessengerAttachmentContext =
  | { kind: 'direct'; conversationId: string }
  | { kind: 'group'; roomId: string }
  | { kind: 'direct_broadcast'; conversationIds: string[] };

export type MessengerAttachmentCandidate = {
  uri: string;
  name: string;
  size?: number | null;
  mimeType?: string | null;
  webFile?: Blob | null;
};

export type SelectedMessengerAttachment = {
  clientFileId: string;
  uri: string;
  webFile?: Blob;
  name: string;
  size: number;
  mimeType: MessengerAttachmentMimeType;
  sha256: string;
};

export type PreparedMessengerAttachmentBatch = {
  context: MessengerAttachmentContext;
  content: string;
  deliveryKey: string;
  payloadFingerprint: string;
  files: SelectedMessengerAttachment[];
};

export type MessengerAttachmentUploadResult =
  | { state: 'uploaded'; intentIds: string[] }
  | { state: 'committed'; messageIds: string[] };

type UploadIntent = {
  id: string;
  clientFileId: string;
  order: number;
  upload: {
    bucket: typeof MESSENGER_ATTACHMENT_BUCKET;
    path: string;
    token: string;
    signedUrl: string;
  };
};

type PendingUploadIntentResponse = {
  ok: true;
  state: 'pending';
  deliveryKey: string;
  payloadFingerprint: string;
  expiresAt: string;
  intents: UploadIntent[];
};

type CommittedUploadIntentResponse = {
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

type UploadIntentResponse =
  | PendingUploadIntentResponse
  | CommittedUploadIntentResponse;

export class MessengerAttachmentError extends Error {
  readonly code?: string;
  readonly status?: number;

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message);
    this.name = 'MessengerAttachmentError';
    this.code = options?.code;
    this.status = options?.status;
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function bytesToHex(value: ArrayBuffer) {
  return Array.from(
    new Uint8Array(value),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

const cleanAttachmentName = cleanMessengerAttachmentName;
const getCanonicalAttachmentMimeType = getMessengerAttachmentMimeType;

function assertAttachmentSize(size: number) {
  if (
    !Number.isSafeInteger(size)
    || size < 1
    || size > MAX_MESSENGER_ATTACHMENT_BYTES
  ) {
    throw new MessengerAttachmentError(
      size > MAX_MESSENGER_ATTACHMENT_BYTES
        ? MESSENGER_ATTACHMENT_ERROR_COPY.tooLarge
        : MESSENGER_ATTACHMENT_ERROR_COPY.readFailed,
      { code: 'invalid_attachment_size' },
    );
  }
}

function normalizeUuid(value: string, code: string) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!isNotificationUuid(normalized)) {
    throw new MessengerAttachmentError(
      MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
      { code },
    );
  }
  return normalized;
}

export function normalizeMessengerAttachmentContext(
  context: MessengerAttachmentContext,
): MessengerAttachmentContext {
  if (context.kind === 'direct') {
    return {
      kind: 'direct',
      conversationId: normalizeUuid(
        context.conversationId,
        'invalid_attachment_context',
      ),
    };
  }
  if (context.kind === 'group') {
    return {
      kind: 'group',
      roomId: normalizeUuid(context.roomId, 'invalid_attachment_context'),
    };
  }

  const conversationIds = context.conversationIds.map((conversationId) =>
    normalizeUuid(conversationId, 'invalid_attachment_context')
  );
  if (
    conversationIds.length < 1
    || conversationIds.length > 200
    || new Set(conversationIds).size !== conversationIds.length
  ) {
    throw new MessengerAttachmentError(
      MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
      { code: 'invalid_attachment_context' },
    );
  }
  return {
    kind: 'direct_broadcast',
    conversationIds: [...conversationIds].sort((left, right) =>
      left.localeCompare(right)
    ),
  };
}

async function readCandidateBytes(candidate: MessengerAttachmentCandidate) {
  try {
    if (candidate.webFile) {
      return new Uint8Array(await candidate.webFile.arrayBuffer());
    }
    return await new ExpoFile(candidate.uri).bytes();
  } catch {
    throw new MessengerAttachmentError(
      MESSENGER_ATTACHMENT_ERROR_COPY.readFailed,
      { code: 'attachment_read_failed' },
    );
  }
}

async function sha256Bytes(bytes: Uint8Array<ArrayBuffer>) {
  return bytesToHex(
    await digest(CryptoDigestAlgorithm.SHA256, bytes),
  ).toLowerCase();
}

function selectedAttachmentIdentity(
  attachment: Pick<
    SelectedMessengerAttachment,
    'name' | 'size' | 'mimeType' | 'sha256'
  >,
) {
  return [
    attachment.name,
    attachment.size,
    attachment.mimeType,
    attachment.sha256,
  ].join('\u0000');
}

export async function appendMessengerAttachmentCandidates(
  existing: readonly SelectedMessengerAttachment[],
  candidates: readonly MessengerAttachmentCandidate[],
): Promise<SelectedMessengerAttachment[]> {
  if (candidates.length === 0) return [...existing];
  if (existing.length > MAX_MESSENGER_ATTACHMENTS) {
    throw new MessengerAttachmentError(
      MESSENGER_ATTACHMENT_ERROR_COPY.tooMany,
      { code: 'too_many_attachments' },
    );
  }

  const next = [...existing];
  const identities = new Set(next.map(selectedAttachmentIdentity));

  for (const candidate of candidates) {
    const name = cleanAttachmentName(candidate.name);
    const mimeType = getCanonicalAttachmentMimeType(
      name,
      candidate.mimeType,
    );
    if (!name || !mimeType) {
      throw new MessengerAttachmentError(
        MESSENGER_ATTACHMENT_ERROR_COPY.unsupported,
        { code: 'unsupported_attachment_type' },
      );
    }
    if (candidate.size != null) {
      assertAttachmentSize(candidate.size);
    }

    const bytes = await readCandidateBytes(candidate);
    assertAttachmentSize(bytes.byteLength);
    if (
      candidate.size != null
      && Number.isSafeInteger(candidate.size)
      && candidate.size !== bytes.byteLength
    ) {
      throw new MessengerAttachmentError(
        MESSENGER_ATTACHMENT_ERROR_COPY.readFailed,
        { code: 'attachment_size_changed' },
      );
    }

    const prepared: SelectedMessengerAttachment = {
      clientFileId: randomUUID().toLowerCase(),
      uri: candidate.uri,
      ...(candidate.webFile ? { webFile: candidate.webFile } : {}),
      name,
      size: bytes.byteLength,
      mimeType,
      sha256: await sha256Bytes(bytes),
    };
    const identity = selectedAttachmentIdentity(prepared);
    if (identities.has(identity)) continue;
    if (next.length >= MAX_MESSENGER_ATTACHMENTS) {
      throw new MessengerAttachmentError(
        MESSENGER_ATTACHMENT_ERROR_COPY.tooMany,
        { code: 'too_many_attachments' },
      );
    }
    identities.add(identity);
    next.push(prepared);
  }

  return next;
}

export function removeSelectedMessengerAttachment(
  selected: readonly SelectedMessengerAttachment[],
  clientFileId: string,
) {
  return selected.filter((attachment) =>
    attachment.clientFileId !== clientFileId
  );
}

export async function prepareMessengerAttachmentBatch(input: {
  files: readonly SelectedMessengerAttachment[];
  context: MessengerAttachmentContext;
  content: string;
  deliveryKey?: string;
}): Promise<PreparedMessengerAttachmentBatch> {
  if (
    input.files.length < 1
    || input.files.length > MAX_MESSENGER_ATTACHMENTS
  ) {
    throw new MessengerAttachmentError(
      MESSENGER_ATTACHMENT_ERROR_COPY.tooMany,
      { code: 'invalid_attachment_count' },
    );
  }

  const context = normalizeMessengerAttachmentContext(input.context);
  const content = normalizeMessengerAttachmentContent(input.content);
  const deliveryKey = input.deliveryKey
    ? normalizeUuid(input.deliveryKey, 'invalid_delivery_key')
    : randomUUID().toLowerCase();
  const files = input.files.map((file) => {
    const clientFileId = normalizeUuid(
      file.clientFileId,
      'invalid_client_file_id',
    );
    const name = cleanAttachmentName(file.name);
    const mimeType = getCanonicalAttachmentMimeType(name, file.mimeType);
    const sha256 = String(file.sha256 ?? '').trim().toLowerCase();
    assertAttachmentSize(file.size);
    if (!name || !mimeType || !SHA256_PATTERN.test(sha256)) {
      throw new MessengerAttachmentError(
        MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
        { code: 'invalid_attachment_metadata' },
      );
    }
    return {
      ...file,
      clientFileId,
      name,
      mimeType,
      sha256,
    };
  });

  const canonical = {
    version: 1,
    context,
    content,
    files: files.map((file, order) => ({
      order,
      clientFileId: file.clientFileId,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      sha256: file.sha256,
    })),
  };
  const payloadFingerprint = (
    await digestStringAsync(
      CryptoDigestAlgorithm.SHA256,
      JSON.stringify(canonical),
    )
  ).toLowerCase();

  return {
    context,
    content,
    deliveryKey,
    payloadFingerprint,
    files,
  };
}

export function isPreparedMessengerAttachmentBatchForDraft(
  batch: PreparedMessengerAttachmentBatch | null | undefined,
  input: {
    files: readonly SelectedMessengerAttachment[];
    context: MessengerAttachmentContext;
    content: string;
  },
) {
  if (!batch) return false;
  let context: MessengerAttachmentContext;
  try {
    context = normalizeMessengerAttachmentContext(input.context);
  } catch {
    return false;
  }
  return (
    JSON.stringify(batch.context) === JSON.stringify(context)
    && batch.content === normalizeMessengerAttachmentContent(input.content)
    && batch.files.length === input.files.length
    && batch.files.every((file, index) => {
      const draft = input.files[index];
      return Boolean(draft)
        && file.clientFileId === draft.clientFileId.toLowerCase()
        && file.name === cleanAttachmentName(draft.name)
        && file.size === draft.size
        && file.mimeType === draft.mimeType
        && file.sha256 === draft.sha256.toLowerCase();
    })
  );
}

function buildUploadIntentBody(batch: PreparedMessengerAttachmentBatch) {
  return {
    type: 'upload_intents_create' as const,
    context: batch.context,
    deliveryKey: batch.deliveryKey,
    payloadFingerprint: batch.payloadFingerprint,
    files: batch.files.map((file) => ({
      clientFileId: file.clientFileId,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      sha256: file.sha256,
    })),
  };
}

function readErrorStatus(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const context = (error as { context?: unknown }).context;
  if (
    context
    && typeof context === 'object'
    && typeof (context as { status?: unknown }).status === 'number'
  ) {
    return (context as { status: number }).status;
  }
  return undefined;
}

async function readFunctionErrorPayload(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object') return null;
  const response = context as {
    clone?: () => { json?: () => Promise<unknown> };
    json?: () => Promise<unknown>;
  };
  const reader = typeof response.clone === 'function'
    ? response.clone()
    : response;
  if (typeof reader.json !== 'function') return null;
  try {
    const value = await reader.json();
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function invokeMessengerAttachmentFunction<T>(
  body: Record<string, unknown>,
  sessionToken?: string,
) {
  const appSessionToken = sessionToken ?? await getStoredAppSessionToken();
  if (!appSessionToken) {
    throw new MessengerAttachmentError(
      MESSENGER_ATTACHMENT_ERROR_COPY.missingSession,
      { code: 'missing_app_session', status: 401 },
    );
  }
  const { data, error } = await supabase.functions.invoke<T & {
    ok?: boolean;
    code?: string;
    message?: string;
  }>(MESSENGER_ATTACHMENT_FUNCTION, {
    body,
    headers: {
      'x-app-session-token': appSessionToken,
    },
  });
  if (error || !data || data.ok !== true) {
    const payload = await readFunctionErrorPayload(error);
    const message =
      (typeof payload?.message === 'string' && payload.message)
      || (typeof data?.message === 'string' && data.message)
      || MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed;
    const code =
      (typeof payload?.code === 'string' && payload.code)
      || (typeof data?.code === 'string' && data.code)
      || undefined;
    throw new MessengerAttachmentError(message, {
      code,
      status: readErrorStatus(error),
    });
  }
  return data;
}

function parseUploadIntentResponse(
  value: unknown,
  batch: PreparedMessengerAttachmentBatch,
): UploadIntentResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MessengerAttachmentError(
      MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
      { code: 'invalid_attachment_response' },
    );
  }
  const response = value as Record<string, unknown>;
  if (
    response.ok !== true
    || response.deliveryKey !== batch.deliveryKey
    || response.payloadFingerprint !== batch.payloadFingerprint
  ) {
    throw new MessengerAttachmentError(
      MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
      { code: 'invalid_attachment_response' },
    );
  }

  if (response.state === 'committed') {
    const committed =
      response.committed
      && typeof response.committed === 'object'
      && !Array.isArray(response.committed)
        ? response.committed as Record<string, unknown>
        : null;
    const messageIds = Array.isArray(committed?.messageIds)
      ? committed.messageIds
      : [];
    if (
      response.expiresAt !== null
      || !Array.isArray(response.intents)
      || response.intents.length !== 0
      || !committed
      || !isNotificationUuid(committed.batchId)
      || messageIds.length < 1
      || !messageIds.every(isNotificationUuid)
    ) {
      throw new MessengerAttachmentError(
        MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
        { code: 'invalid_attachment_response' },
      );
    }
    return response as unknown as CommittedUploadIntentResponse;
  }

  const intents = Array.isArray(response.intents) ? response.intents : [];
  const expectedByClientId = new Map(
    batch.files.map((file, order) => [file.clientFileId, order]),
  );
  if (
    response.state !== 'pending'
    || typeof response.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(response.expiresAt))
    || intents.length !== batch.files.length
  ) {
    throw new MessengerAttachmentError(
      MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
      { code: 'invalid_attachment_response' },
    );
  }
  const seenClientIds = new Set<string>();
  for (const rawIntent of intents) {
    if (!rawIntent || typeof rawIntent !== 'object' || Array.isArray(rawIntent)) {
      throw new MessengerAttachmentError(
        MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
        { code: 'invalid_attachment_response' },
      );
    }
    const intent = rawIntent as Record<string, unknown>;
    const upload =
      intent.upload
      && typeof intent.upload === 'object'
      && !Array.isArray(intent.upload)
        ? intent.upload as Record<string, unknown>
        : null;
    const clientFileId =
      typeof intent.clientFileId === 'string'
        ? intent.clientFileId.toLowerCase()
        : '';
    if (
      !isNotificationUuid(intent.id)
      || !expectedByClientId.has(clientFileId)
      || seenClientIds.has(clientFileId)
      || intent.order !== expectedByClientId.get(clientFileId)
      || upload?.bucket !== MESSENGER_ATTACHMENT_BUCKET
      || typeof upload.path !== 'string'
      || !upload.path
      || typeof upload.token !== 'string'
      || !upload.token
      || typeof upload.signedUrl !== 'string'
      || !upload.signedUrl
    ) {
      throw new MessengerAttachmentError(
        MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
        { code: 'invalid_attachment_response' },
      );
    }
    seenClientIds.add(clientFileId);
  }
  return response as unknown as PendingUploadIntentResponse;
}

async function requestUploadIntents(batch: PreparedMessengerAttachmentBatch) {
  const response = await invokeMessengerAttachmentFunction<UploadIntentResponse>(
    buildUploadIntentBody(batch),
  );
  return parseUploadIntentResponse(response, batch);
}

function isExactAssetAlreadyExistsError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as {
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  };
  const status = Number(value.status ?? value.statusCode);
  const message =
    typeof value.message === 'string'
      ? value.message.trim().toLowerCase()
      : '';
  return status === 409
    && (
      message === 'asset already exists'
      || message === 'the resource already exists'
    );
}

async function uploadPendingIntents(
  batch: PreparedMessengerAttachmentBatch,
  intents: UploadIntent[],
) {
  const filesByClientId = new Map(
    batch.files.map((file) => [file.clientFileId, file]),
  );
  for (const intent of [...intents].sort((left, right) =>
    left.order - right.order
  )) {
    const file = filesByClientId.get(intent.clientFileId.toLowerCase());
    if (!file) {
      throw new MessengerAttachmentError(
        MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
        { code: 'invalid_attachment_response' },
      );
    }
    const bytes = await readCandidateBytes({
      uri: file.uri,
      name: file.name,
      size: file.size,
      mimeType: file.mimeType,
      webFile: file.webFile,
    });
    if (
      bytes.byteLength !== file.size
      || await sha256Bytes(bytes) !== file.sha256
    ) {
      throw new MessengerAttachmentError(
        MESSENGER_ATTACHMENT_ERROR_COPY.readFailed,
        { code: 'attachment_content_changed' },
      );
    }
    const { error } = await supabase.storage
      .from(intent.upload.bucket)
      .uploadToSignedUrl(
        intent.upload.path,
        intent.upload.token,
        bytes,
        {
          contentType: file.mimeType,
          upsert: false,
        },
      );
    if (error && !isExactAssetAlreadyExistsError(error)) {
      throw new MessengerAttachmentError(
        MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
        { code: 'attachment_upload_failed' },
      );
    }
  }
}

export async function uploadMessengerAttachmentBatch(
  batch: PreparedMessengerAttachmentBatch,
): Promise<MessengerAttachmentUploadResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await requestUploadIntents(batch);
    if (response.state === 'committed') {
      return {
        state: 'committed',
        messageIds: response.committed.messageIds.map((id) =>
          id.toLowerCase()
        ),
      };
    }
    try {
      await uploadPendingIntents(batch, response.intents);
      return {
        state: 'uploaded',
        intentIds: [...response.intents]
          .sort((left, right) => left.order - right.order)
          .map((intent) => intent.id.toLowerCase()),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new MessengerAttachmentError(
        MESSENGER_ATTACHMENT_ERROR_COPY.uploadFailed,
        { code: 'attachment_upload_failed' },
      );
}

export function formatMessengerAttachmentSize(size: number) {
  if (!Number.isFinite(size) || size < 0) return '0 B';
  if (size < 1024) return `${Math.floor(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

export class MessengerAttachmentCommitUncertainError extends Error {
  constructor() {
    super('메시지 저장 결과를 확인하지 못했습니다.');
    this.name = 'MessengerAttachmentCommitUncertainError';
  }
}

// Upload errors are definite failures. Only a failed commit response needs
// reconciliation; the same delivery key can confirm a saved message without
// uploading again or sending a second message.
export async function sendMessengerAttachmentBatch<T>(
  batch: PreparedMessengerAttachmentBatch,
  commit: (intentIds: string[]) => Promise<T>,
): Promise<{ state: 'sent'; result: T } | { state: 'committed' }> {
  const upload = await uploadMessengerAttachmentBatch(batch);
  if (upload.state === 'committed') return { state: 'committed' };
  try {
    return { state: 'sent', result: await commit(upload.intentIds) };
  } catch (error) {
    // Preserve explicit authentication/validation failures. They must not be
    // disguised as a connectivity problem with an endless retry prompt.
    const status = error && typeof error === 'object' && 'status' in error
      ? Number(error.status) : undefined;
    if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
      throw error;
    }
    try {
      const recovered = await requestUploadIntents(batch);
      if (recovered.state === 'committed') return { state: 'committed' };
    } catch {
      // Unavailable recovery is not evidence that the original commit failed.
    }
    throw new MessengerAttachmentCommitUncertainError();
  }
}

export async function createMessengerAttachmentDownloadUrl(
  attachmentId: string,
) {
  return (await createMessengerAttachmentPreviewUrl(attachmentId)).signedUrl;
}

export async function createMessengerAttachmentPreviewUrl(
  attachmentId: string,
  sessionToken?: string,
) {
  const id = normalizeUuid(attachmentId, 'invalid_attachment_id');
  const response = await invokeMessengerAttachmentFunction<{
    ok: true;
    attachment?: unknown;
    download?: unknown;
  }>({
    type: 'download_url_create',
    attachmentId: id,
  }, sessionToken);
  const download =
    response.download
    && typeof response.download === 'object'
    && !Array.isArray(response.download)
      ? response.download as Record<string, unknown>
      : null;
  const attachment = parseMessengerAttachmentMetadataList([
    response.attachment,
  ])[0];
  const signedUrl =
    typeof download?.signedUrl === 'string'
      ? download.signedUrl.trim()
      : '';
  if (
    !signedUrl
    || attachment.id !== id
    || typeof download?.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(download.expiresAt))
  ) {
    throw new MessengerAttachmentError(
      MESSENGER_ATTACHMENT_ERROR_COPY.downloadFailed,
      { code: 'invalid_attachment_download_response' },
    );
  }
  return { signedUrl, expiresAt: download.expiresAt };
}
