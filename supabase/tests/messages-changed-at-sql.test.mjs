import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/20261016144208_messages_changed_at.sql', import.meta.url), 'utf8');

const schema = `
create role anon; create role authenticated;
create table messages(id uuid primary key default gen_random_uuid(), sender_id text not null, receiver_id text not null,
  content text not null default '', created_at timestamptz not null default now(), is_read boolean not null default false,
  deleted_at timestamptz, conversation_id uuid, thread_id uuid);
insert into messages(id, sender_id, receiver_id, content) values ('00000000-0000-4000-8000-000000000001', 'a', 'b', 'before');
`;

const changedAt = async (db, messageId) =>
  (await db.query('select changed_at from messages where id = $1', [messageId])).rows[0].changed_at;

test('messages carry a change time that moves on insert, read and delete', async () => {
  const db = new PGlite();
  await db.exec(schema);
  await db.exec(migration);
  await db.exec(migration); // re-runnable

  const existing = await changedAt(db, '00000000-0000-4000-8000-000000000001');
  assert.ok(existing instanceof Date, 'existing rows get a change time');

  await db.query(`insert into messages(id, sender_id, receiver_id, content) values ('00000000-0000-4000-8000-000000000002', 'b', 'a', 'new')`);
  const inserted = await changedAt(db, '00000000-0000-4000-8000-000000000002');
  assert.ok(inserted >= existing);

  await db.query(`update messages set is_read = true where id = '00000000-0000-4000-8000-000000000002'`);
  const read = await changedAt(db, '00000000-0000-4000-8000-000000000002');
  assert.ok(read > inserted, 'a read mark moves the change time');

  await db.query(`update messages set deleted_at = now(), content = '' where id = '00000000-0000-4000-8000-000000000001'`);
  const deleted = await changedAt(db, '00000000-0000-4000-8000-000000000001');
  assert.ok(deleted > existing, 'a delete moves the change time');

  const changed = await db.query('select id from messages where changed_at > $1 order by changed_at', [inserted]);
  assert.deepEqual(changed.rows.map((row) => row.id), [
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
  ]);
});

test('a client cannot write the change time itself', async () => {
  const db = new PGlite();
  await db.exec(schema);
  await db.exec(migration);
  await db.query(`update messages set changed_at = '2000-01-01' where id = '00000000-0000-4000-8000-000000000001'`);
  const value = await changedAt(db, '00000000-0000-4000-8000-000000000001');
  assert.ok(value.getUTCFullYear() > 2000);
});
