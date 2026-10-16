import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  GARAMLINK_SYNC_MAX_BATCHES,
  garamLinkExportUrl,
  parseGaramLinkCursor,
  parseGaramLinkExportResponse,
  runGaramLinkSync,
  type GaramLinkExportBatch,
  type GaramLinkExportCursor,
} from '../_shared/messenger-garamlink-sync.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const cursorAt = (id: number): GaramLinkExportCursor => ({ createdAt: `2026-10-01T00:00:0${id}+00:00`, source: 'request', id });

// A fake GaramLink with `total` messages served `size` at a time, plus a fake
// database that keeps the cursor and refuses stale writes like the SQL does.
function harness(total: number, size: number) {
  let stored: GaramLinkExportCursor | null = null;
  const imported: number[] = [];
  const fetchBatch = async (cursor: GaramLinkExportCursor | null): Promise<GaramLinkExportBatch> => {
    const from = cursor?.id ?? 0;
    const ids = Array.from({ length: Math.max(0, Math.min(size, total - from)) }, (_, i) => from + i + 1);
    return {
      users: [],
      messages: ids.map((id) => ({ id })),
      skippedDeleted: 0,
      cursor: ids.length ? cursorAt(ids[ids.length - 1]) : cursor,
      hasMore: from + ids.length < total,
    };
  };
  return {
    imported,
    stored: () => stored,
    deps: {
      readCursor: async () => stored,
      fetchBatch,
      importBatch: async (payload: { messages: unknown[] }, expected: GaramLinkExportCursor | null, next: GaramLinkExportCursor | null) => {
        if (JSON.stringify(expected) !== JSON.stringify(stored)) throw new Error('cursor_conflict');
        imported.push(...payload.messages.map((m) => (m as { id: number }).id));
        stored = next;
        return { users: 0, messages: payload.messages.length };
      },
    },
  };
}

test('sync pages until GaramLink says no more and stores the last cursor', async () => {
  const h = harness(7, 3);
  const result = await runGaramLinkSync(h.deps);
  assert.deepEqual(h.imported, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(result.batches, 3);
  assert.equal(result.messages, 7);
  assert.equal(result.caughtUp, true);
  assert.deepEqual(h.stored(), cursorAt(7));

  const again = await runGaramLinkSync(h.deps);
  assert.equal(again.batches, 0, 'nothing new means no import call');
  assert.equal(again.caughtUp, true);
});

test('a batch of only deleted rows still moves the cursor', async () => {
  let stored: GaramLinkExportCursor | null = null;
  const calls: Array<[GaramLinkExportCursor | null, GaramLinkExportCursor | null]> = [];
  const result = await runGaramLinkSync({
    readCursor: async () => stored,
    fetchBatch: async (cursor) => cursor
      ? { users: [], messages: [], skippedDeleted: 0, cursor, hasMore: false }
      : { users: [], messages: [], skippedDeleted: 2, cursor: cursorAt(2), hasMore: false },
    importBatch: async (_payload, expected, next) => { calls.push([expected, next]); stored = next; return { users: 0, messages: 0 }; },
  });
  assert.deepEqual(calls, [[null, cursorAt(2)]]);
  assert.equal(result.skippedDeleted, 2);
});

test('sync stops at the batch cap and the time budget', async () => {
  const capped = harness(10_000, 1);
  const result = await runGaramLinkSync(capped.deps);
  assert.equal(result.batches, GARAMLINK_SYNC_MAX_BATCHES);
  assert.equal(result.caughtUp, false);

  let clock = 0;
  const slow = harness(100, 1);
  const timed = await runGaramLinkSync({ ...slow.deps, now: () => (clock += 15_000) });
  assert.ok(timed.batches < 4, `stopped after ${timed.batches} batches`);
});

test('a failed import leaves the stored cursor where it was', async () => {
  const h = harness(5, 2);
  let calls = 0;
  await assert.rejects(runGaramLinkSync({
    ...h.deps,
    importBatch: async (payload, expected, next) => {
      calls += 1;
      if (calls === 2) throw new Error('import_failed: boom');
      return h.deps.importBatch(payload, expected, next);
    },
  }), /import_failed/);
  assert.deepEqual(h.stored(), cursorAt(2));
  const resumed = await runGaramLinkSync(h.deps);
  assert.equal(resumed.caughtUp, true);
  assert.deepEqual(h.imported, [1, 2, 3, 4, 5]);
});

test('export responses and cursors are validated before anything is imported', () => {
  assert.throws(() => parseGaramLinkExportResponse({ success: false }), /garamlink_export_invalid/);
  assert.throws(() => parseGaramLinkExportResponse({ success: true, data: { users: [], messages: {}, hasMore: false } }), /garamlink_export_invalid/);
  assert.throws(() => parseGaramLinkCursor({ createdAt: 'x', source: 'request', id: 1 }), /garamlink_cursor_invalid/);
  assert.throws(() => parseGaramLinkCursor({ createdAt: '2026-10-01T00:00:00Z', source: 'other', id: 1 }), /garamlink_cursor_invalid/);
  assert.equal(parseGaramLinkCursor(null), null);
  const parsed = parseGaramLinkExportResponse({
    success: true,
    data: { users: [{ id: 1 }], messages: [], skippedDeleted: 1, cursor: cursorAt(3), hasMore: false },
  });
  assert.deepEqual(parsed.cursor, cursorAt(3));
  assert.equal(parsed.skippedDeleted, 1);
});

test('export URL carries the cursor as query parameters', () => {
  const url = new URL(garamLinkExportUrl('https://garamlink.example/api/messenger-export', cursorAt(4), 200));
  assert.equal(url.searchParams.get('limit'), '200');
  assert.equal(url.searchParams.get('afterCreatedAt'), '2026-10-01T00:00:04+00:00');
  assert.equal(url.searchParams.get('afterSource'), 'request');
  assert.equal(url.searchParams.get('afterId'), '4');
  assert.equal(new URL(garamLinkExportUrl('https://garamlink.example/api/messenger-export', null)).search, '?limit=500');
});

test('the Edge handler accepts only the service key and imports through the cursor RPC', () => {
  const source = readFileSync(join(root, 'supabase', 'functions', 'messenger-garamlink-sync', 'index.ts'), 'utf8');
  assert.match(source, /isTrustedFcNotifyServiceKey\(request\.headers\.get\('apikey'\), serviceKey\)/);
  assert.match(source, /isTrustedFcNotifyServiceKey\(bearer, serviceKey\)/);
  assert.match(source, /rpc\('messenger_import_request_board_batch_v1'/);
  assert.match(source, /rpc\('messenger_import_record_error_v1'/);
  assert.doesNotMatch(source, /console\.(log|info)/);
  const config = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  assert.match(config, /\[functions\.messenger-garamlink-sync\]\r?\nverify_jwt = false/);
});
