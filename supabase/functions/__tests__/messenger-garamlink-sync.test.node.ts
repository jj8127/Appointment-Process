import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  GARAMLINK_SYNC_MAX_BATCHES,
  garamLinkAttachmentPath,
  garamLinkDeletionUrl,
  garamLinkExportUrl,
  isAllowedAttachmentUrl,
  parseGaramLinkCursor,
  parseGaramLinkDeletionResponse,
  parseGaramLinkExportResponse,
  prepareGaramLinkMessages,
  runCursorFeed,
  type CursorFeed,
  type GaramLinkExportCursor,
} from '../_shared/messenger-garamlink-sync.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const cursorAt = (id: number): GaramLinkExportCursor => ({ createdAt: `2026-10-01T00:00:0${id}+00:00`, source: 'request', id });
type FakeBatch = { ids: number[]; cursor: GaramLinkExportCursor | null; hasMore: boolean };

// A fake GaramLink with `total` rows served `size` at a time, plus a fake
// database that keeps the cursor and refuses stale writes like the SQL does.
function harness(total: number, size: number) {
  let stored: GaramLinkExportCursor | null = null;
  const imported: number[] = [];
  const feed: CursorFeed<GaramLinkExportCursor, FakeBatch> = {
    readCursor: async () => stored,
    fetchBatch: async (cursor) => {
      const from = cursor?.id ?? 0;
      const ids = Array.from({ length: Math.max(0, Math.min(size, total - from)) }, (_, i) => from + i + 1);
      return { ids, cursor: ids.length ? cursorAt(ids[ids.length - 1]) : cursor, hasMore: from + ids.length < total };
    },
    importBatch: async (batch, expected) => {
      if (JSON.stringify(expected) !== JSON.stringify(stored)) throw new Error('cursor_conflict');
      imported.push(...batch.ids);
      stored = batch.cursor;
      return batch.ids.length;
    },
    cursorOf: (batch) => batch.cursor,
    sizeOf: (batch) => batch.ids.length,
    hasMore: (batch) => batch.hasMore,
  };
  return { imported, stored: () => stored, feed };
}
const far = () => Date.now() + 60_000;

test('a feed pages until GaramLink says no more and stores the last cursor', async () => {
  const h = harness(7, 3);
  const result = await runCursorFeed(h.feed, far());
  assert.deepEqual(h.imported, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual([result.batches, result.imported, result.caughtUp], [3, 7, true]);
  assert.deepEqual(h.stored(), cursorAt(7));
  const again = await runCursorFeed(h.feed, far());
  assert.deepEqual([again.batches, again.caughtUp], [0, true], 'nothing new means no import call');
});

test('a batch that only moves the cursor (deleted rows) is still imported', async () => {
  let stored: GaramLinkExportCursor | null = null;
  const calls: unknown[] = [];
  await runCursorFeed<GaramLinkExportCursor, FakeBatch>({
    readCursor: async () => stored,
    fetchBatch: async (cursor) => (cursor ? { ids: [], cursor, hasMore: false } : { ids: [], cursor: cursorAt(2), hasMore: false }),
    importBatch: async (batch, expected) => { calls.push([expected, batch.cursor]); stored = batch.cursor; return 0; },
    cursorOf: (batch) => batch.cursor,
    sizeOf: (batch) => batch.ids.length,
    hasMore: (batch) => batch.hasMore,
  }, far());
  assert.deepEqual(calls, [[null, cursorAt(2)]]);
});

test('a feed stops at the batch cap and at the deadline', async () => {
  const capped = await runCursorFeed(harness(10_000, 1).feed, far());
  assert.deepEqual([capped.batches, capped.caughtUp], [GARAMLINK_SYNC_MAX_BATCHES, false]);
  let clock = 0;
  const timed = await runCursorFeed(harness(100, 1).feed, 40_000, () => (clock += 15_000));
  assert.ok(timed.batches < 4, `stopped after ${timed.batches} batches`);
});

test('a failed import leaves the stored cursor where it was and the next run resumes', async () => {
  const h = harness(5, 2);
  let calls = 0;
  await assert.rejects(runCursorFeed({
    ...h.feed,
    importBatch: async (batch, expected) => {
      calls += 1;
      if (calls === 2) throw new Error('import_failed: boom');
      return h.feed.importBatch(batch, expected);
    },
  }, far()), /import_failed/);
  assert.deepEqual(h.stored(), cursorAt(2));
  assert.equal((await runCursorFeed(h.feed, far())).caughtUp, true);
  assert.deepEqual(h.imported, [1, 2, 3, 4, 5]);
});

test('files are copied to a fixed path; missing links and lost files are imported as missing', async () => {
  const copies: string[] = [];
  const prepared = await prepareGaramLinkMessages([
    { source: 'request', id: 7, content: 'x', attachments: [
      { id: 70, fileName: 'plan.pdf', fileType: 'application/pdf', fileSize: 10, downloadUrl: 'https://rb.supabase.co/storage/v1/object/sign/a' },
      { id: 71, fileName: 'gone.pdf', fileType: 'application/pdf', fileSize: 10, downloadUrl: 'https://rb.supabase.co/storage/v1/object/sign/b' },
      { id: 72, fileName: 'none.pdf', fileType: 'application/pdf', fileSize: null, downloadUrl: null },
    ] },
    { source: 'direct', id: 9, content: 'y' },
  ], async (attachment, path) => { copies.push(path); return attachment.id === 71 ? 'missing' : 'copied'; });
  assert.deepEqual(copies, ['request_board/request/7/70', 'request_board/request/7/71']);
  assert.deepEqual([prepared.copied, prepared.missing], [1, 2]);
  assert.deepEqual(prepared.messages[0].attachments, [
    { id: 70, fileName: 'plan.pdf', fileType: 'application/pdf', fileSize: 10, storagePath: 'request_board/request/7/70', missing: false },
    { id: 71, fileName: 'gone.pdf', fileType: 'application/pdf', fileSize: 10, storagePath: null, missing: true },
    { id: 72, fileName: 'none.pdf', fileType: 'application/pdf', fileSize: null, storagePath: null, missing: true },
  ]);
  assert.deepEqual(prepared.messages[1].attachments, []);
  assert.equal(garamLinkAttachmentPath('direct', 9, 90), 'request_board/direct/9/90');

  await assert.rejects(prepareGaramLinkMessages([{ source: 'request', id: 1, attachments: [
    { id: 1, fileName: 'a', fileType: 'a/b', fileSize: 1, downloadUrl: 'https://rb.supabase.co/storage/v1/object/sign/c' },
  ] }], async () => { throw new Error('garamlink_file_http_500'); }), /garamlink_file_http_500/, 'a transient failure fails the batch');
});

test('only https links into GaramLink storage are fetched', () => {
  const origin = 'https://rb.supabase.co';
  assert.equal(isAllowedAttachmentUrl('https://rb.supabase.co/storage/v1/object/sign/x?token=t', origin), true);
  assert.equal(isAllowedAttachmentUrl('https://rb.supabase.co/storage/v1/object/public/chat/x.png', origin), true);
  assert.equal(isAllowedAttachmentUrl('http://rb.supabase.co/storage/v1/object/sign/x', origin), false);
  assert.equal(isAllowedAttachmentUrl('https://evil.example/storage/v1/object/sign/x', origin), false);
  assert.equal(isAllowedAttachmentUrl('https://rb.supabase.co/rest/v1/users', origin), false);
  assert.equal(isAllowedAttachmentUrl('not a url', origin), false);
});

test('export and deletion responses and cursors are validated before anything is imported', () => {
  assert.throws(() => parseGaramLinkExportResponse({ success: false }), /garamlink_export_invalid/);
  assert.throws(() => parseGaramLinkExportResponse({ success: true, data: { users: [], messages: {}, hasMore: false } }), /garamlink_export_invalid/);
  assert.throws(() => parseGaramLinkExportResponse({ success: true, data: { users: [], hasMore: false,
    messages: [{ source: 'request', id: 1, attachments: [{ id: 1, fileName: 'a', fileType: 'b', fileSize: 1, downloadUrl: 5 }] }] } }), /garamlink_export_invalid/);
  assert.throws(() => parseGaramLinkCursor({ createdAt: 'x', source: 'request', id: 1 }), /garamlink_cursor_invalid/);
  assert.equal(parseGaramLinkCursor(null), null);
  const parsed = parseGaramLinkExportResponse({ success: true, data: { users: [{ id: 1 }], hasMore: false, skippedDeleted: 1, cursor: cursorAt(3),
    messages: [{ source: 'direct', id: 3, content: 'x' }] } });
  assert.deepEqual(parsed.cursor, cursorAt(3));
  assert.deepEqual(parsed.messages[0].attachments, [], 'a message without attachments gets an empty list');
  assert.throws(() => parseGaramLinkDeletionResponse({ success: true, data: { deletions: [{ source: 'x', id: 1, deletedAt: '2026-10-01T00:00:00Z' }], hasMore: false } }),
    /garamlink_export_invalid/);
  const deletions = parseGaramLinkDeletionResponse({ success: true, data: {
    deletions: [{ source: 'request', id: 7, deletedAt: '2026-10-03T00:00:00Z' }], cursor: { deletedAt: '2026-10-03T00:00:00Z', source: 'request', id: 7 }, hasMore: false } });
  assert.deepEqual(deletions.cursor, { deletedAt: '2026-10-03T00:00:00Z', source: 'request', id: 7 });
});

test('feed URLs carry their cursors as query parameters', () => {
  const url = new URL(garamLinkExportUrl('https://garamlink.example/api/messenger-export', cursorAt(4), 200));
  assert.deepEqual([...url.searchParams], [['limit', '200'], ['afterCreatedAt', '2026-10-01T00:00:04+00:00'], ['afterSource', 'request'], ['afterId', '4']]);
  assert.equal(new URL(garamLinkExportUrl('https://garamlink.example/api/messenger-export', null)).search, '?limit=100');
  const del = new URL(garamLinkDeletionUrl('https://garamlink.example/api/messenger-export/', { deletedAt: '2026-10-03T00:00:00Z', source: 'direct', id: 9 }));
  assert.equal(del.pathname, '/api/messenger-export/deletions');
  assert.deepEqual([...del.searchParams], [['limit', '500'], ['afterDeletedAt', '2026-10-03T00:00:00Z'], ['afterSource', 'direct'], ['afterId', '9']]);
});

test('the Edge handler accepts only the service key and imports both feeds through the cursor RPCs', () => {
  const source = readFileSync(join(root, 'supabase', 'functions', 'messenger-garamlink-sync', 'index.ts'), 'utf8');
  assert.match(source, /isTrustedFcNotifyServiceKey\(request\.headers\.get\('apikey'\), serviceKey\)/);
  assert.match(source, /isTrustedFcNotifyServiceKey\(bearer, serviceKey\)/);
  assert.match(source, /rpc\('messenger_import_request_board_batch_v1'/);
  assert.match(source, /rpc\('messenger_import_request_board_deletions_batch_v1'/);
  assert.match(source, /rpc\('messenger_import_record_error_v1'/);
  assert.match(source, /isAllowedAttachmentUrl\(attachment\.downloadUrl, storageOrigin\)/);
  assert.match(source, /!storageOrigin\) return json\(\{ ok: false, error: 'not_configured' \}, 503\)/);
  assert.doesNotMatch(source, /console\.(log|info)/);
  const config = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  assert.match(config, /\[functions\.messenger-garamlink-sync\]\r?\nverify_jwt = false/);
});
