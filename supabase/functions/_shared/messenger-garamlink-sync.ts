// Pulls GaramLink (request_board) chats into the unified Moduon messenger.
// GaramLink serves GET /api/messenger-export; each batch is imported together
// with its cursor by public.messenger_import_request_board_batch_v1.

export type GaramLinkExportCursor = {
  createdAt: string;
  source: 'direct' | 'request';
  id: number;
};

export type GaramLinkExportBatch = {
  users: unknown[];
  messages: unknown[];
  skippedDeleted: number;
  cursor: GaramLinkExportCursor | null;
  hasMore: boolean;
};

export type GaramLinkSyncDeps = {
  readCursor: () => Promise<GaramLinkExportCursor | null>;
  fetchBatch: (cursor: GaramLinkExportCursor | null) => Promise<GaramLinkExportBatch>;
  importBatch: (
    payload: { users: unknown[]; messages: unknown[] },
    expected: GaramLinkExportCursor | null,
    next: GaramLinkExportCursor | null,
  ) => Promise<{ users: number; messages: number }>;
  now?: () => number;
};

export type GaramLinkSyncResult = {
  batches: number;
  users: number;
  messages: number;
  skippedDeleted: number;
  cursor: GaramLinkExportCursor | null;
  caughtUp: boolean;
};

export const GARAMLINK_SYNC_MAX_BATCHES = 20;
// pg_net gives the call 60 seconds; stop starting new batches well before that.
export const GARAMLINK_SYNC_TIME_BUDGET_MS = 40_000;
export const GARAMLINK_EXPORT_LIMIT = 500;

const isCursor = (value: unknown): value is GaramLinkExportCursor => {
  if (!value || typeof value !== 'object') return false;
  const cursor = value as Record<string, unknown>;
  return typeof cursor.createdAt === 'string'
    && !Number.isNaN(Date.parse(cursor.createdAt))
    && (cursor.source === 'direct' || cursor.source === 'request')
    && Number.isSafeInteger(cursor.id) && (cursor.id as number) > 0;
};

export function parseGaramLinkCursor(value: unknown): GaramLinkExportCursor | null {
  if (value === null || value === undefined) return null;
  if (!isCursor(value)) throw new Error('garamlink_cursor_invalid');
  return { createdAt: value.createdAt, source: value.source, id: value.id };
}

export function parseGaramLinkExportResponse(body: unknown): GaramLinkExportBatch {
  const envelope = body as { success?: unknown; data?: Record<string, unknown> } | null;
  const data = envelope?.data;
  if (envelope?.success !== true || !data || typeof data !== 'object') throw new Error('garamlink_export_invalid');
  if (!Array.isArray(data.users) || !Array.isArray(data.messages) || typeof data.hasMore !== 'boolean') {
    throw new Error('garamlink_export_invalid');
  }
  const skippedDeleted = typeof data.skippedDeleted === 'number' ? data.skippedDeleted : 0;
  return {
    users: data.users,
    messages: data.messages,
    skippedDeleted,
    cursor: parseGaramLinkCursor(data.cursor),
    hasMore: data.hasMore,
  };
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

const sameCursor = (a: GaramLinkExportCursor | null, b: GaramLinkExportCursor | null) =>
  a === b || (!!a && !!b && a.createdAt === b.createdAt && a.source === b.source && a.id === b.id);

export async function runGaramLinkSync(deps: GaramLinkSyncDeps): Promise<GaramLinkSyncResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const result: GaramLinkSyncResult = { batches: 0, users: 0, messages: 0, skippedDeleted: 0, cursor: null, caughtUp: false };
  let cursor = await deps.readCursor();
  result.cursor = cursor;

  while (result.batches < GARAMLINK_SYNC_MAX_BATCHES && now() - startedAt < GARAMLINK_SYNC_TIME_BUDGET_MS) {
    const batch = await deps.fetchBatch(cursor);
    if (batch.messages.length === 0 && sameCursor(batch.cursor, cursor)) {
      result.caughtUp = true;
      break;
    }
    const imported = await deps.importBatch({ users: batch.users, messages: batch.messages }, cursor, batch.cursor);
    result.batches += 1;
    result.users += imported.users;
    result.messages += imported.messages;
    result.skippedDeleted += batch.skippedDeleted;
    cursor = batch.cursor;
    result.cursor = cursor;
    if (!batch.hasMore) {
      result.caughtUp = true;
      break;
    }
  }
  return result;
}
