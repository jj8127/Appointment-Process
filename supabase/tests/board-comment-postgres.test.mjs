// Independent connections to the explicit loopback-only disposable test cluster.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import test, { before, after } from 'node:test';
import { fixtureSql, migration, rpc } from './board-comment-fixture.mjs';
const require = createRequire(import.meta.url);
const { Client } = require(process.env.PG_MODULE_PATH ?? 'pg');
const port = Number(process.env.OTP_TEST_POSTGRES_PORT);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, 'explicit disposable local port required');
const config = { host: '127.0.0.1', port, user: 'otp_fixture', password: 'synthetic-local-only',
  ssl: false, connectionTimeoutMillis: 3000, options: '-c statement_timeout=8000 -c lock_timeout=6000' };
const database = `board_comment_regression_${process.pid}`;
const clients = [];
let admin, db, first, second;
async function connect() {
  const client = new Client({ ...config, database });
  await client.connect(); clients.push(client); return client;
}
before(async () => {
  admin = new Client({ ...config, database: 'postgres' }); await admin.connect();
  await admin.query(`create database ${database}`);
  db = await connect(); first = await connect(); second = await connect();
  await db.query(fixtureSql);
  await db.query('begin;\n' + migration + '\ncommit;');
});
after(async () => {
  await Promise.all(clients.map(client => client.end()));
  if (admin) { await admin.query(`drop database if exists ${database}`); await admin.end(); }
});
async function waitForLock() {
  for (let i = 0; i < 200; i++) {
    const row = (await db.query('select wait_event_type from pg_stat_activity where pid=$1', [second.processID])).rows[0];
    if (row?.wait_event_type === 'Lock') return;
    await delay(10);
  }
  assert.fail('competing request did not wait for the first transaction');
}
async function reset() { await db.query('truncate board_comments, notifications, board_comment_requests cascade'); }
async function assertOne() {
  const row = (await db.query('select (select count(*)::int from board_comments) comments, (select count(*)::int from notifications) notifications')).rows[0];
  assert.deepEqual(row, { comments: 1, notifications: 1 });
}

test('concurrent duplicate requests wait for commit and return the same atomic receipt', async () => {
  await reset();
  const id = randomUUID();
  await first.query('begin');
  const original = await rpc(first, id);
  const pending = rpc(second, id);
  try { await waitForLock(); } finally { await first.query('commit'); }
  assert.deepEqual(await pending, original);
  await assertOne();
});

test('rollback releases the request key and allows exactly one subsequent writer', async () => {
  await reset();
  const id = randomUUID();
  await first.query('begin');
  const rolledBack = await rpc(first, id);
  const pending = rpc(second, id);
  try { await waitForLock(); } finally { await first.query('rollback'); }
  const committed = await pending;
  assert.notEqual(committed.data.id, rolledBack.data.id);
  assert.deepEqual(await rpc(first, id), committed);
  await assertOne();
});

test('a concurrent payload mismatch cannot replace the first writer', async () => {
  await reset();
  const id = randomUUID();
  await first.query('begin'); await rpc(first, id);
  const pending = rpc(second, id, { content: 'different payload' });
  try { await waitForLock(); } finally { await first.query('commit'); }
  assert.deepEqual(await pending, { ok: false, code: 'request_id_conflict' });
  await assertOne();
});
