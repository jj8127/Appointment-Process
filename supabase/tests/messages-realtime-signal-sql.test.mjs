import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/20261016150000_messages_realtime_signal.sql', import.meta.url), 'utf8');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const THREAD_A = id(1), THREAD_B = id(2);

// PGlite has no Vault, Realtime or pgcrypto: small stand-ins with the same signatures.
const schema = `
create role anon; create role authenticated; create role service_role;
create schema vault; create schema realtime; create schema extensions;
create table vault.secrets(name text primary key, secret text not null);
create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text, new_description text) returns uuid
  language sql as $$ insert into vault.secrets values (new_name, new_secret); select gen_random_uuid() $$;
create function extensions.gen_random_bytes(n int) returns bytea
  language sql as $$ select decode(md5(random()::text) || md5(random()::text), 'hex') $$;
create function extensions.hmac(data text, key text, type text) returns bytea
  language sql as $$ select sha256(convert_to(key || ':' || data, 'utf8')) $$;
create table realtime.sent(topic text, event text, payload jsonb, private boolean);
create function realtime.send(payload jsonb, event text, topic text, private boolean) returns void
  language sql as $$ insert into realtime.sent values (topic, event, payload, private) $$;
create table messages(id uuid primary key default gen_random_uuid(), sender_id text not null, receiver_id text not null,
  content text not null default '', is_read boolean not null default false, deleted_at timestamptz, thread_id uuid);
`;

const sent = async (db) => (await db.query('select topic, event, payload, private from realtime.sent order by topic')).rows;
const topic = async (db, thread) => (await db.query('select public.messenger_direct_realtime_topic_v1($1) t', [thread])).rows[0].t;

test('one content-free signal per changed conversation, on a hashed public channel', async () => {
  const db = new PGlite();
  await db.exec(schema);
  await db.exec(migration);
  await db.exec(migration); // re-runnable, and the key is created once
  assert.equal((await db.query('select count(*)::int n from vault.secrets')).rows[0].n, 1);

  const topicA = await topic(db, THREAD_A);
  assert.match(topicA, /^dm-[0-9a-f]{64}$/);
  assert.ok(!topicA.includes(THREAD_A.replaceAll('-', '')), 'the channel name does not reveal the thread');
  assert.notEqual(topicA, await topic(db, THREAD_B));

  await db.query(`insert into messages(sender_id, receiver_id, content, thread_id) values
    ('a','b','one',$1), ('a','b','two',$1), ('c','d','three',$2), ('e','f','legacy',null)`, [THREAD_A, THREAD_B]);
  let rows = await sent(db);
  assert.equal(rows.length, 2, 'one per conversation, none without a thread');
  assert.deepEqual(new Set(rows.map((row) => row.topic)), new Set([topicA, await topic(db, THREAD_B)]));
  for (const row of rows) {
    assert.equal(row.event, 'changed');
    assert.equal(row.private, false);
    assert.deepEqual(Object.keys(row.payload), ['at'], 'no message data in the payload');
  }

  await db.exec('delete from realtime.sent');
  await db.query('update messages set is_read = true where thread_id = $1', [THREAD_A]);
  rows = await sent(db);
  assert.deepEqual(rows.map((row) => row.topic), [topicA], 'marking many rows read sends one signal');
});

test('a missing key or a broken sender never blocks the message write', async () => {
  const db = new PGlite();
  await db.exec(schema);
  await db.exec(migration);
  await db.exec('delete from vault.secrets');
  assert.equal(await topic(db, THREAD_A), null);
  await db.query(`insert into messages(sender_id, receiver_id, thread_id) values ('a','b',$1)`, [THREAD_A]);
  assert.equal((await sent(db)).length, 0);

  await db.exec(`insert into vault.secrets values ('messenger_realtime_topic_key', 'k');
    create or replace function realtime.send(payload jsonb, event text, topic text, private boolean) returns void
      language plpgsql as $$ begin raise exception 'realtime down'; end $$;`);
  await db.query(`insert into messages(sender_id, receiver_id, thread_id) values ('a','b',$1)`, [THREAD_A]);
  assert.equal((await db.query('select count(*)::int n from messages')).rows[0].n, 2);
});
