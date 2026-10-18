import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function source(name: string) {
  return readFileSync(
    join(process.cwd(), `supabase/functions/${name}/index.ts`),
    'utf8',
  );
}

test('board mutations reject unverified durable mutation results', () => {
  for (const name of [
    'board-pin',
    'board-comment-update',
    'board-comment-delete',
    'board-attachment-delete',
    'board-category-update',
    'board-reaction-toggle',
    'board-comment-like-toggle',
    'board-delete',
    'board-attachment-finalize',
  ]) {
    const body = source(name);
    assert.match(body, /mutation_receipt_unverified/);
    assert.match(body, /\.select\(/);
  }
});

test('attachment deletion requires exact deleted rows and surfaces storage cleanup failure', () => {
  const body = source('board-attachment-delete');
  const cleanupFailure = body.indexOf("code: 'storage_cleanup_failed'");
  const databaseDelete = body.search(/\.from\('board_attachments'\)\s*\.delete\(\)/);

  assert.match(body, /parseQueryRows\(attachments, isBoardAttachmentQueryRow\)/);
  assert.match(body, /parseQueryRows\(deleted, isBoardAttachmentQueryRow\)/);
  assert.match(body, /deletedRows\.length !== attachmentRows\.length/);
  assert.match(body, /cleanupPending: false/);
  assert.ok(cleanupFailure >= 0);
  assert.ok(databaseDelete > cleanupFailure);
  assert.doesNotMatch(body, /Continue with DB deletion even if storage fails/);
});

test('post deletion returns the requested post receipt only after attachment cleanup succeeds', () => {
  const body = source('board-delete');
  const cleanupFailure = body.indexOf("code: 'storage_cleanup_failed'");
  const postDelete = body.search(/\.from\('board_posts'\)\s*\.delete\(\)/);

  assert.match(body, /requireMutationRowReceipt\(data, \{ id: postId \}\)/);
  assert.match(body, /data: \{ postId: data\.id, cleanupPending: false \}/);
  assert.ok(cleanupFailure >= 0);
  assert.ok(postDelete > cleanupFailure);
});

test('attachment finalization validates existing rows and the exact inserted path set', () => {
  const body = source('board-attachment-finalize');

  assert.match(body, /parseQueryRows\(existingRows, isBoardAttachmentQueryRow\)/);
  assert.match(body, /parseQueryRows\(inserted, isBoardAttachmentQueryRow\)/);
  assert.match(body, /insertedRows\.length !== rows\.length/);
  assert.match(body, /hasUniqueStringField\(insertedRows, 'storage_path'\)/);
  assert.match(body, /requireMutationRowReceipt\(row, expectedByPath\.get\(row\.storage_path\)!\)/);
  assert.doesNotMatch(body, /\(existingRows \?\? \[\]\)\.length/);
});

test('comment-like count errors and null counts cannot become a synthetic zero success', () => {
  const body = source('board-comment-like-toggle');

  assert.match(body, /const \{ count, error: countError \}/);
  assert.match(body, /const likeCount = parseQueryCount\(count\)/);
  assert.match(body, /if \(likeCount === null\)/);
  assert.doesNotMatch(body, /count \?\? 0/);
});
