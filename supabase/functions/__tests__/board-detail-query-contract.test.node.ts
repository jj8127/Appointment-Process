import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  collectGroupChatDataApiBatches,
  collectGroupChatDataApiPages,
} from '../_shared/group-chat-data-api-batching.ts';

const root = join(import.meta.dirname, '..', '..', '..');
const detailSource = readFileSync(
  join(root, 'supabase', 'functions', 'board-detail', 'index.ts'),
  'utf8',
);
const boardSource = readFileSync(
  join(root, 'supabase', 'functions', '_shared', 'board.ts'),
  'utf8',
);

test('board detail pages every relation with stable ordering before exact-count validation', () => {
  assert.equal((detailSource.match(/collectGroupChatDataApiPages\(/g) ?? []).length, 3);
  assert.equal((detailSource.match(/\.range\(from, to\)/g) ?? []).length, 3);
  assert.match(detailSource, /board_attachments[\s\S]*?order\('sort_order'[\s\S]*?order\('created_at'[\s\S]*?order\('id'/);
  assert.match(detailSource, /board_post_reactions[\s\S]*?order\('resident_id'/);
  assert.match(detailSource, /board_comments_with_stats[\s\S]*?order\('created_at'[\s\S]*?order\('id'/);
  assert.match(detailSource, /post\.attachment_count !== attachmentRows\.length/);
  assert.match(detailSource, /post\.reaction_count !== reactionRows\.length/);
  assert.match(detailSource, /post\.comment_count !== commentRows\.length/);
});

test('board detail chunks comment and author identifiers before Data API in-filters', () => {
  assert.match(detailSource, /collectGroupChatDataApiBatches\([\s\S]*?\[\.\.\.commentIds\][\s\S]*?\.in\('comment_id', commentIdBatch\)/);
  assert.match(boardSource, /collectGroupChatDataApiBatches\([\s\S]*?adminResidentIds[\s\S]*?\.in\('phone', phoneBatch\)/);
});

test('board detail fails closed when any attachment URL cannot be signed', () => {
  assert.match(detailSource, /signed\.error[\s\S]*?typeof signed\.data\?\.signedUrl !== 'string'/);
  assert.match(detailSource, /code: 'attachment_signing_failed'/);
  assert.doesNotMatch(detailSource, /signedUrl: signed\.data\?\.signedUrl \?\? undefined/);
});

test('shared page and batch collectors preserve all 1001 rows', async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => index);
  const pageCalls: [number, number][] = [];
  const paged = await collectGroupChatDataApiPages(async (from, to) => {
    pageCalls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  }, 100);
  assert.equal(paged.ok, true);
  if (paged.ok) assert.deepEqual(paged.data, rows);
  assert.deepEqual(pageCalls.at(-1), [1001, 1100]);

  const batchSizes: number[] = [];
  const batched = await collectGroupChatDataApiBatches(rows, async (batch) => {
    batchSizes.push(batch.length);
    return { data: batch, error: null };
  });
  assert.equal(batched.ok, true);
  if (batched.ok) assert.deepEqual(batched.data, rows);
  assert.deepEqual(batchSizes, [...Array(10).fill(100), 1]);
});
