// Pulls GaramLink (request_board) chats into the unified Moduon messenger.
// GaramLink serves two feeds:
//   GET /api/messenger-export            messages (with signed file links)
//   GET /api/messenger-export/deletions  deletions
// Each batch is imported together with its cursor in one transaction
// (messenger_import_request_board_batch_v1 / _deletions_batch_v1). Files are
// copied into the private 'messenger-imported-attachments' bucket before the
// batch that refers to them is imported.

export type GaramLinkExportCursor = {
  createdAt: string;
  source: 'direct' | 'request';
  id: number;
};

export type GaramLinkDeletionCursor = {
  deletedAt: string;
  source: 'direct' | 'request';
  id: number;
};

export type GaramLinkExportAttachment = {
  id: number;
  fileName: string;
  fileType: string;
  fileSize: number | null;
  downloadUrl: string | null;
};

export type GaramLinkImportAttachment = {
  id: number;
  fileName: string;
  fileType: string;
  fileSize: number | null;
  storagePath: string | null;
  missing: boolean;
};

export type GaramLinkExportMessage = Record<string, unknown> & {
  source: 'direct' | 'request';
  id: number;
  attachments?: GaramLinkExportAttachment[];
};

export type GaramLinkExportBatch = {
  users: unknown[];
  messages: GaramLinkExportMessage[];
  skippedDeleted: number;
  cursor: GaramLinkExportCursor | null;
  hasMore: boolean;
};

export type GaramLinkDeletionBatch = {
  deletions: Array<{ source: 'direct' | 'request'; id: number; deletedAt: string }>;
  cursor: GaramLinkDeletionCursor | null;
  hasMore: boolean;
};

// 'copied' when the file is in the bucket, 'missing' when GaramLink no longer
// has it (it is imported as a missing file); anything else throws and the
// whole batch is retried on the next run.
export type CopyAttachment = (attachment: GaramLinkExportAttachment, storagePath: string) => Promise<'copied' | 'missing'>;

export type CursorFeed<TCursor, TBatch> = {
  readCursor: () => Promise<TCursor | null>;
  fetchBatch: (cursor: TCursor | null) => Promise<TBatch>;
  importBatch: (batch: TBatch, expected: TCursor | null) => Promise<number>;
  cursorOf: (batch: TBatch) => TCursor | null;
  sizeOf: (batch: TBatch) => number;
  hasMore: (batch: TBatch) => boolean;
};

export type CursorFeedResult<TCursor> = {
  batches: number;
  imported: number;
  cursor: TCursor | null;
  caughtUp: boolean;
};

export const GARAMLINK_SYNC_MAX_BATCHES = 20;
// pg_net gives the call 60 seconds; stop starting new batches well before that.
export const GARAMLINK_SYNC_TIME_BUDGET_MS = 40_000;
// Batches carry files to copy, so they stay small.
export const GARAMLINK_EXPORT_LIMIT = 100;
export const GARAMLINK_DELETION_LIMIT = 500;
export const GARAMLINK_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
export const GARAMLINK_ATTACHMENT_BUCKET = 'messenger-imported-attachments';

const isSource = (value: unknown): value is 'direct' | 'request' => value === 'direct' || value === 'request';
const isTime = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

export function parseGaramLinkCursor(value: unknown): GaramLinkExportCursor | null {
  if (value === null || value === undefined) return null;
  const cursor = value as Record<string, unknown>;
  if (!isTime(cursor.createdAt) || !isSource(cursor.source) || !isId(cursor.id)) throw new Error('garamlink_cursor_invalid');
  return { createdAt: cursor.createdAt, source: cursor.source, id: cursor.id };
}

export function parseGaramLinkDeletionCursor(value: unknown): GaramLinkDeletionCursor | null {
  if (value === null || value === undefined) return null;
  const cursor = value as Record<string, unknown>;
  if (!isTime(cursor.deletedAt) || !isSource(cursor.source) || !isId(cursor.id)) throw new Error('garamlink_cursor_invalid');
  return { deletedAt: cursor.deletedAt, source: cursor.source, id: cursor.id };
}

const envelopeData = (body: unknown): Record<string, unknown> => {
  const envelope = body as { success?: unknown; data?: unknown } | null;
  if (envelope?.success !== true || !envelope.data || typeof envelope.data !== 'object') throw new Error('garamlink_export_invalid');
  return envelope.data as Record<string, unknown>;
};

const parseAttachment = (value: unknown): GaramLinkExportAttachment => {
  const a = value as Record<string, unknown>;
  if (!a || !isId(a.id) || typeof a.fileName !== 'string' || typeof a.fileType !== 'string'
    || (a.fileSize !== null && typeof a.fileSize !== 'number')
    || (a.downloadUrl !== null && typeof a.downloadUrl !== 'string')) {
    throw new Error('garamlink_export_invalid');
  }
  return { id: a.id, fileName: a.fileName, fileType: a.fileType, fileSize: a.fileSize as number | null, downloadUrl: a.downloadUrl as string | null };
};

export function parseGaramLinkExportResponse(body: unknown): GaramLinkExportBatch {
  const data = envelopeData(body);
  if (!Array.isArray(data.users) || !Array.isArray(data.messages) || typeof data.hasMore !== 'boolean') {
    throw new Error('garamlink_export_invalid');
  }
  const messages = data.messages.map((value) => {
    const m = value as Record<string, unknown>;
    if (!m || !isSource(m.source) || !isId(m.id)) throw new Error('garamlink_export_invalid');
    const attachments = m.attachments === undefined ? [] : m.attachments;
    if (!Array.isArray(attachments)) throw new Error('garamlink_export_invalid');
    return { ...m, source: m.source, id: m.id, attachments: attachments.map(parseAttachment) } as GaramLinkExportMessage;
  });
  return {
    users: data.users,
    messages,
    skippedDeleted: typeof data.skippedDeleted === 'number' ? data.skippedDeleted : 0,
    cursor: parseGaramLinkCursor(data.cursor),
    hasMore: data.hasMore,
  };
}

export function parseGaramLinkDeletionResponse(body: unknown): GaramLinkDeletionBatch {
  const data = envelopeData(body);
  if (!Array.isArray(data.deletions) || typeof data.hasMore !== 'boolean') throw new Error('garamlink_export_invalid');
  const deletions = data.deletions.map((value) => {
    const d = value as Record<string, unknown>;
    if (!d || !isSource(d.source) || !isId(d.id) || !isTime(d.deletedAt)) throw new Error('garamlink_export_invalid');
    return { source: d.source, id: d.id, deletedAt: d.deletedAt };
  });
  return { deletions, cursor: parseGaramLinkDeletionCursor(data.cursor), hasMore: data.hasMore };
}

export function garamLinkExportUrl(baseUrl: string, cursor: GaramLinkExportCursor | null, limit = GARAMLINK_EXPORT_LIMIT): string {
  const url = new URL(baseUrl);
  url.searchParams.set('limit', String(limit));
  if (cursor) {
    url.searchParams.set('afterCreatedAt', cursor.createdAt);
    url.searchParams.set('afterSource', cursor.source);
    url.searchParams.set('afterId', String(cursor.id));
  }
  return url.toString();
}

export function garamLinkDeletionUrl(baseUrl: string, cursor: GaramLinkDeletionCursor | null, limit = GARAMLINK_DELETION_LIMIT): string {
  const url = new URL(baseUrl.replace(/\/+$/, '') + '/deletions');
  url.searchParams.set('limit', String(limit));
  if (cursor) {
    url.searchParams.set('afterDeletedAt', cursor.deletedAt);
    url.searchParams.set('afterSource', cursor.source);
    url.searchParams.set('afterId', String(cursor.id));
  }
  return url.toString();
}

// Only links into GaramLink's own storage are fetched (no request goes to a
// host taken from the export body).
export function isAllowedAttachmentUrl(downloadUrl: string, storageOrigin: string): boolean {
  try {
    const url = new URL(downloadUrl);
    const allowed = new URL(storageOrigin);
    return url.protocol === 'https:' && url.origin === allowed.origin && url.pathname.startsWith('/storage/v1/object/');
  } catch {
    return false;
  }
}

export const garamLinkAttachmentPath = (source: 'direct' | 'request', messageId: number, attachmentId: number) =>
  `request_board/${source}/${messageId}/${attachmentId}`;

// Copies every file of a batch and returns the messages in the importer's shape.
export async function prepareGaramLinkMessages(
  messages: GaramLinkExportMessage[],
  copy: CopyAttachment,
): Promise<{ messages: Record<string, unknown>[]; copied: number; missing: number }> {
  let copied = 0;
  let missing = 0;
  const out: Record<string, unknown>[] = [];
  for (const message of messages) {
    const attachments: GaramLinkImportAttachment[] = [];
    for (const attachment of message.attachments ?? []) {
      const storagePath = garamLinkAttachmentPath(message.source, message.id, attachment.id);
      const result = attachment.downloadUrl ? await copy(attachment, storagePath) : 'missing';
      if (result === 'copied') copied += 1; else missing += 1;
      attachments.push({
        id: attachment.id,
        fileName: attachment.fileName,
        fileType: attachment.fileType,
        fileSize: attachment.fileSize,
        storagePath: result === 'copied' ? storagePath : null,
        missing: result !== 'copied',
      });
    }
    out.push({ ...message, attachments });
  }
  return { messages: out, copied, missing };
}

export async function runCursorFeed<TCursor, TBatch>(
  feed: CursorFeed<TCursor, TBatch>,
  deadline: number,
  now: () => number = Date.now,
): Promise<CursorFeedResult<TCursor>> {
  const result: CursorFeedResult<TCursor> = { batches: 0, imported: 0, cursor: null, caughtUp: false };
  let cursor: TCursor | null = await feed.readCursor();
  result.cursor = cursor;

  while (result.batches < GARAMLINK_SYNC_MAX_BATCHES && now() < deadline) {
    const batch = await feed.fetchBatch(cursor);
    const next = feed.cursorOf(batch);
    if (feed.sizeOf(batch) === 0 && JSON.stringify(next) === JSON.stringify(cursor)) {
      result.caughtUp = true;
      break;
    }
    result.imported += await feed.importBatch(batch, cursor);
    result.batches += 1;
    cursor = next;
    result.cursor = cursor;
    if (!feed.hasMore(batch)) {
      result.caughtUp = true;
      break;
    }
  }
  return result;
}
