import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fixtureSql, migration, postId, rpc } from './board-comment-fixture.mjs';
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
async function fixture() {
  const db = new PGlite();
  await db.exec(fixtureSql);
  await db.exec('begin;\n' + migration + '\ncommit;');
  return db;
}
async function counts(db) {
  return (await db.query('select (select count(*)::int from board_comments) comments, (select count(*)::int from notifications) notifications')).rows[0];
}

test('a lost response followed by identical retries returns one comment and one notification', async () => {
  const db = await fixture();
  try {
    const request = randomUUID();
    const first = await rpc(db, request);
    const retries = await Promise.all(Array.from({length: 4}, () => rpc(db, request)));
    retries.forEach(result => assert.deepEqual(result, first));
    assert.deepEqual(await counts(db), { comments: 1, notifications: 1 });
    const notification = (await db.query('select target, target_url, delivery_key from notifications')).rows[0];
    assert.deepEqual(notification.target, { version: 1, kind: 'board_post', postId });
    assert.equal(notification.target_url, '/board?postId=' + postId);
    assert.ok(notification.delivery_key.startsWith('board-comment:' + first.data.id + ':'));
  } finally { await db.close(); }
});

test('same operation ID with different payload conflicts; distinct IDs allow identical comments', async () => {
  const db = await fixture();
  try {
    const request = randomUUID();
    await rpc(db, request);
    assert.deepEqual(await rpc(db, request, { content: 'changed' }), { ok: false, code: 'request_id_conflict' });
    await rpc(db, randomUUID());
    assert.deepEqual(await counts(db), { comments: 2, notifications: 2 });
  } finally { await db.close(); }
});

test('deleted comments/posts retain receipts so a delayed retry cannot recreate them', async () => {
  const db = await fixture();
  try {
    const request = randomUUID();
    const first = await rpc(db, request);
    await db.query('delete from board_posts where id=$1', [postId]);
    assert.deepEqual(await rpc(db, request), first);
    assert.deepEqual(await counts(db), { comments: 0, notifications: 1 });
  } finally { await db.close(); }
});

test('invalid parents roll back the receipt and replies persist the selected parent', async () => {
  const db = await fixture();
  try {
    const request = randomUUID();
    await assert.rejects(rpc(db, request, { parentId: randomUUID() }), /invalid_parent/);
    assert.equal((await db.query('select count(*)::int n from board_comment_requests')).rows[0].n, 0);
    const parent = await rpc(db, randomUUID(), { phone: '00000000002' });
    const reply = await rpc(db, request, { parentId: parent.data.id });
    assert.equal((await db.query('select parent_id from board_comments where id=$1', [reply.data.id])).rows[0].parent_id, parent.data.id);
    assert.deepEqual(await counts(db), { comments: 2, notifications: 1 });
  } finally { await db.close(); }
});

test('notification persistence failure rolls back the comment and operation receipt', async () => {
  const db = await fixture();
  try {
    await db.exec("alter table notifications add constraint reject_fixture check (title <> 'New comment')");
    const request = randomUUID();
    await assert.rejects(rpc(db, request), /reject_fixture/);
    assert.deepEqual(await counts(db), { comments: 0, notifications: 0 });
    assert.equal((await db.query('select count(*)::int n from board_comment_requests')).rows[0].n, 0);
    await db.exec('alter table notifications drop constraint reject_fixture');
    assert.equal((await rpc(db, request)).ok, true);
  } finally { await db.close(); }
});

test('request keys are actor-scoped and anon/authenticated cannot call the RPC or read receipts', async () => {
  const db = await fixture();
  try {
    const request = randomUUID();
    const first = await rpc(db, request);
    const second = await rpc(db, request, { phone: '00000000002' });
    assert.notEqual(first.data.id, second.data.id);
    for (const role of ['anon', 'authenticated']) {
      const acl = (await db.query("select has_function_privilege($1, 'public.create_board_comment_idempotent(text,text,text,uuid,uuid,uuid,text)', 'EXECUTE') execute, has_table_privilege($1, 'public.board_comment_requests', 'SELECT') read", [role])).rows[0];
      assert.deepEqual(acl, { execute: false, read: false });
    }
    await db.exec('set role service_role');
    assert.equal((await rpc(db, randomUUID())).ok, true);
  } finally { await db.close(); }
});
