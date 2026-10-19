import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/20261016151419_messenger_direct_thread_snapshot.sql', import.meta.url), 'utf8');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FC = id(1), SHADOW_FC = id(2), CONV = id(11), SHADOW_CONV = id(12);
const ADMIN = id(21), DEV = id(22), OFF_ADMIN = id(23), MANAGER = id(31), OFF_MANAGER = id(32);
const T_ADMIN_INBOX = id(41), T_ADMIN = id(42), T_DEV = id(43), T_MANAGER = id(44), T_OFF_MANAGER = id(45), T_SHADOW = id(46), T_DEV_AS_ADMIN = id(47);

const schema = `
create role anon; create role authenticated; create role service_role;
create table fc_profiles(id uuid primary key, phone text, name text, affiliation text, signup_completed boolean, is_manager_referral_shadow boolean);
create table admin_accounts(id uuid primary key, name text, phone text, staff_type text, active boolean);
create table manager_accounts(id uuid primary key, name text, phone text, active boolean);
create table garamin_direct_conversations(id uuid primary key, fc_id uuid not null references fc_profiles);
create table garamin_direct_threads(id uuid primary key, legacy_conversation_id uuid not null references garamin_direct_conversations,
  counterparty_role text not null, counterparty_actor_id uuid);
insert into fc_profiles values ('${FC}', '01000000001', 'FC', '가람', true, false), ('${SHADOW_FC}', '01000000002', 'S', '가람', true, true);
insert into admin_accounts values ('${ADMIN}', '총무', '01000000003', 'admin', true), ('${DEV}', '개발', '01000000004', 'developer', true),
  ('${OFF_ADMIN}', '퇴사', '01000000005', 'admin', false);
insert into manager_accounts values ('${MANAGER}', '본부장', '01000000006', true), ('${OFF_MANAGER}', '전본부장', '01000000007', false);
insert into garamin_direct_conversations values ('${CONV}', '${FC}'), ('${SHADOW_CONV}', '${SHADOW_FC}');
insert into garamin_direct_threads values
  ('${T_ADMIN_INBOX}', '${CONV}', 'admin', null), ('${T_ADMIN}', '${CONV}', 'admin', '${ADMIN}'),
  ('${T_DEV}', '${CONV}', 'developer', '${DEV}'), ('${T_MANAGER}', '${CONV}', 'manager', '${MANAGER}'),
  ('${T_OFF_MANAGER}', '${CONV}', 'manager', '${OFF_MANAGER}'), ('${T_SHADOW}', '${SHADOW_CONV}', 'manager', '${MANAGER}'),
  ('${T_DEV_AS_ADMIN}', '${CONV}', 'admin', '${DEV}');
`;

const db = new PGlite();
await db.exec(schema);
await db.exec(migration);
await db.exec(migration); // re-runnable
const snap = async (thread) => (await db.query('select public.messenger_direct_thread_snapshot_v1($1) s', [thread])).rows[0].s;

test('returns the thread, its conversation, the counterparty rows and the profile in one call', async () => {
  const s = await snap(T_MANAGER);
  assert.deepEqual(s.thread, { id: T_MANAGER, legacy_conversation_id: CONV, counterparty_role: 'manager', counterparty_actor_id: MANAGER });
  assert.deepEqual(s.conversation, { id: CONV, fc_id: FC });
  assert.deepEqual(s.counterparty_rows, [{ id: MANAGER, name: '본부장', phone: '01000000006', active: true }]);
  assert.equal(s.profile.id, FC);
  assert.equal(s.profile.phone, '01000000001');
});

test('reads counterparty rows with the same filters as the separate queries', async () => {
  assert.equal((await snap(T_ADMIN_INBOX)).counterparty_rows.length, 1, 'shared admin inbox: any active non-developer admin');
  assert.equal((await snap(T_ADMIN_INBOX)).counterparty_rows[0].staff_type, 'admin');
  assert.deepEqual((await snap(T_ADMIN)).counterparty_rows.map((r) => r.id), [ADMIN]);
  assert.deepEqual((await snap(T_DEV)).counterparty_rows.map((r) => r.id), [DEV]);
  assert.deepEqual((await snap(T_OFF_MANAGER)).counterparty_rows, [], 'inactive manager is not returned');
  assert.deepEqual((await snap(T_DEV_AS_ADMIN)).counterparty_rows, [], 'a developer never answers as admin');
});

test('leaves out a profile the separate query would not return, and unknown threads are null', async () => {
  assert.equal((await snap(T_SHADOW)).profile, null, 'manager referral shadow profiles are excluded');
  assert.equal(await snap(id(99)), null);
});
