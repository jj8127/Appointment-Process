import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const modelMigration = await readFile(new URL('../migrations/20261016100000_messenger_unified_model.sql', import.meta.url), 'utf8');
const backfillMigration = await readFile(new URL('../migrations/20261016100100_messenger_unified_backfill.sql', import.meta.url), 'utf8');
const dailySyncMigration = await readFile(new URL('../migrations/20261016100200_messenger_unified_daily_sync.sql', import.meta.url), 'utf8');
// PGlite has no pg_cron: run the functions here and check the schedule as text.
const [dailySyncFunctions, dailySyncSchedule] = dailySyncMigration.split('-- schedule --');
const garamLinkSyncMigration = await readFile(new URL('../migrations/20261016100300_messenger_garamlink_sync.sql', import.meta.url), 'utf8');
const [garamLinkSyncFunctions, garamLinkSyncSchedule] = garamLinkSyncMigration.split('-- schedule --');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FC = id(1), MANAGER = id(2), ADMIN = id(3), DEVELOPER = id(4), DESIGNER_FC = id(5);
const FC_MEMBER = id(11), CONSUMER = id(12), OTHER_CONSUMER = id(13), PARTNER = id(21);
const CONVERSATION = id(31), INBOX_THREAD = id(32), MANAGER_THREAD = id(33), ROOM = id(41);
const PHONE = { fc: '01000000001', manager: '01000000002', admin: '01000000003', developer: '01000000004', designer: '01000000005' };

const legacySchema = `
create role anon; create role authenticated; create role service_role bypassrls;
create table fc_profiles(id uuid primary key, name text not null, affiliation text not null, phone text not null,
  signup_completed boolean, is_manager_referral_shadow boolean default false, account_closed_at timestamptz);
create table admin_accounts(id uuid primary key, name text not null, phone text not null unique,
  staff_type text not null default 'admin', active boolean not null default true);
create table manager_accounts(id uuid primary key, name text not null, phone text not null unique, active boolean not null default true);
create table platform_partners(id uuid primary key, service_key text not null, name text not null, active boolean not null default true);
create table platform_members(id uuid primary key, phone text, name text, fc_id uuid, staff_account_kind text, staff_account_id uuid);
create table platform_service_applications(id uuid primary key default gen_random_uuid(), member_id uuid not null, service_key text not null);
create table garamin_direct_conversations(id uuid primary key, fc_id uuid not null unique references fc_profiles);
create table garamin_direct_threads(id uuid primary key, legacy_conversation_id uuid not null references garamin_direct_conversations,
  counterparty_role text not null, counterparty_actor_id uuid, created_at timestamptz not null default now());
create table messages(id uuid primary key default gen_random_uuid(), sender_id text not null, receiver_id text not null,
  content text not null default '', created_at timestamptz not null default now(), is_read boolean not null default false,
  message_type text not null default 'text', file_url text, file_name text, file_size bigint,
  sender_actor_id uuid, receiver_actor_id uuid, deleted_at timestamptz, deleted_by_actor_id uuid,
  thread_id uuid references garamin_direct_threads, attachment_batch_id uuid);
create table group_chat_rooms(id uuid primary key, slug text unique, title text not null, created_at timestamptz not null default now());
create table group_chat_messages(id uuid primary key default gen_random_uuid(), room_id uuid not null references group_chat_rooms,
  sender_actor_id text not null, sender_role text not null, sender_phone text not null, sender_name text,
  content text not null default '', message_type text not null default 'text', file_url text, file_name text, file_size bigint,
  created_at timestamptz not null default now(), reply_to_message_id uuid references group_chat_messages,
  deleted_at timestamptz, deleted_by_actor_id text, attachment_batch_id uuid);
create table group_chat_reads(room_id uuid not null, actor_id text not null, last_read_at timestamptz not null default now(),
  last_read_message_id uuid references group_chat_messages, primary key(room_id, actor_id));
create table group_chat_reactions(room_id uuid not null, message_id uuid not null references group_chat_messages on delete cascade,
  actor_id text not null, actor_role text not null, reaction text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(room_id, message_id, actor_id));
create table group_chat_member_send_permissions(room_id uuid not null, actor_id text not null, can_send_messages boolean not null default false,
  primary key(room_id, actor_id));
create table group_chat_notices(room_id uuid primary key, message_id uuid not null references group_chat_messages on delete cascade);
create table messenger_room_notification_preferences(actor_id uuid not null, actor_role text not null, room_key text not null,
  muted boolean not null default false, pinned_at timestamptz, left_at timestamptz, primary key(actor_id, actor_role, room_key));
-- Supabase grants service_role full access to legacy tables.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
`;

const seed = `
insert into fc_profiles values
  ('${FC}', 'Synthetic FC', '가람지사', '${PHONE.fc}', true, false, null),
  ('${DESIGNER_FC}', 'Synthetic Designer', '가람 설계매니저', '${PHONE.designer}', true, false, null);
insert into manager_accounts values ('${MANAGER}', 'Synthetic Manager', '${PHONE.manager}', true);
insert into admin_accounts values ('${ADMIN}', 'Synthetic Admin', '${PHONE.admin}', 'admin', true),
  ('${DEVELOPER}', 'Synthetic Developer', '${PHONE.developer}', 'developer', true);
insert into platform_partners values ('${PARTNER}', 'telecom', 'Synthetic Telecom', true);
insert into platform_members values
  ('${FC_MEMBER}', '${PHONE.fc}', 'Synthetic FC', '${FC}', null, null),
  ('${CONSUMER}', '01000000012', 'Synthetic Consumer', null, null, null),
  ('${OTHER_CONSUMER}', '01000000013', 'Other Consumer', null, null, null);
insert into platform_service_applications(member_id, service_key) values ('${CONSUMER}', 'telecom');
insert into garamin_direct_conversations values ('${CONVERSATION}', '${FC}');
insert into garamin_direct_threads(id, legacy_conversation_id, counterparty_role, counterparty_actor_id) values
  ('${INBOX_THREAD}', '${CONVERSATION}', 'admin', null),
  ('${MANAGER_THREAD}', '${CONVERSATION}', 'manager', '${MANAGER}');
insert into messages(id, sender_id, receiver_id, content, created_at, is_read, sender_actor_id, thread_id) values
  ('${id(101)}', '${PHONE.fc}', 'admin', 'fc to inbox', '2026-10-01T00:00:00Z', true, '${FC}', '${INBOX_THREAD}'),
  ('${id(102)}', 'admin', '${PHONE.fc}', 'inbox to fc', '2026-10-01T00:01:00Z', false, '${ADMIN}', '${INBOX_THREAD}'),
  ('${id(103)}', '${PHONE.manager}', '${PHONE.fc}', 'manager to fc', '2026-10-01T00:00:00Z', true, '${MANAGER}', '${MANAGER_THREAD}'),
  ('${id(104)}', '${PHONE.fc}', '${PHONE.manager}', 'fc to manager', '2026-10-01T00:02:00Z', false, '${FC}', '${MANAGER_THREAD}');
insert into group_chat_rooms values ('${ROOM}', 'garampa-default', '가람PA 단톡방', '2026-09-01T00:00:00Z');
insert into group_chat_messages(id, room_id, sender_actor_id, sender_role, sender_phone, content, created_at) values
  ('${id(201)}', '${ROOM}', 'manager:${PHONE.manager}', 'manager', '${PHONE.manager}', 'notice', '2026-10-01T00:00:00Z'),
  ('${id(202)}', '${ROOM}', 'fc:${PHONE.fc}', 'fc', '${PHONE.fc}', 'reply', '2026-10-01T00:01:00Z');
update group_chat_messages set reply_to_message_id = '${id(201)}' where id = '${id(202)}';
insert into group_chat_reads values ('${ROOM}', 'fc:${PHONE.fc}', now(), '${id(201)}');
insert into group_chat_reactions(room_id, message_id, actor_id, actor_role, reaction) values ('${ROOM}', '${id(201)}', 'fc:${PHONE.fc}', 'fc', '👍');
insert into group_chat_member_send_permissions values ('${ROOM}', 'fc:${PHONE.fc}', true);
insert into group_chat_notices values ('${ROOM}', '${id(201)}');
insert into messenger_room_notification_preferences(actor_id, actor_role, room_key, muted) values
  ('${FC}', 'fc', 'garamin:group:${ROOM}', true),
  ('${ADMIN}', 'admin', 'garamin:direct-thread:${INBOX_THREAD}', true);
`;

async function fixture() {
  const db = new PGlite();
  try {
    await db.exec(legacySchema);
    await db.exec(modelMigration);
    await db.exec(backfillMigration);
    await db.exec(dailySyncFunctions);
    await db.exec(garamLinkSyncFunctions);
    await db.exec(seed);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function call(db, sql, args = []) {
  await db.exec('set role service_role');
  try { return (await db.query(sql, args)).rows; } finally { await db.exec('reset role'); }
}
const one = async (db, sql, args) => (await call(db, sql, args))[0];
const actor = async (db, kind, source) => (await one(db, 'select messenger_actor_for($1,$2) a', [kind, source])).a;
const conversationFor = async (db, kind, key) => (await one(db,
  'select conversation_id c from messenger_legacy_map where source_kind=$1 and source_key=$2', [kind, key])).c;
const seqs = async (db, conversation) => (await call(db,
  'select seq, id, content, sender_actor_id, sender_org_id, reply_to_seq from messenger_messages where conversation_id=$1 order by seq', [conversation]));

test('backfill maps people, organizations, rooms, messages and read positions', async () => {
  const db = await fixture();
  try {
    const result = (await one(db, 'select messenger_backfill_v1() r')).r;
    assert.equal(result.actors, 7);
    const fc = await actor(db, 'fc', FC);
    assert.equal(await actor(db, 'platform_member', FC_MEMBER), fc, 'linked common member joins the FC person');
    assert.notEqual(await actor(db, 'platform_member', CONSUMER), null);

    const garam = (await one(db, "select id from messenger_orgs where slug='garam'")).id;
    const roles = await call(db, 'select role from messenger_org_members where org_id=$1 order by role', [garam]);
    assert.deepEqual(roles.map((r) => r.role), ['admin', 'designer', 'developer', 'fc', 'manager']);
    assert.equal((await one(db, 'select count(*)::int n from messenger_orgs where kind=$1', ['partner'])).n, 1);

    const inbox = await conversationFor(db, 'garamin_direct_thread', INBOX_THREAD);
    const inboxRoom = await one(db, 'select kind, owner_org_id, subject_actor_id from messenger_conversations where id=$1', [inbox]);
    assert.deepEqual(inboxRoom, { kind: 'org_room', owner_org_id: garam, subject_actor_id: fc });
    const inboxMessages = await seqs(db, inbox);
    assert.deepEqual(inboxMessages.map((m) => [Number(m.seq), m.content, m.sender_org_id]),
      [[1, 'fc to inbox', null], [2, 'inbox to fc', garam]]);
    assert.equal(Number((await one(db, 'select last_read_seq s from messenger_conversation_orgs where conversation_id=$1', [inbox])).s), 1);
    assert.equal(Number((await one(db, 'select last_read_seq s from messenger_participants where conversation_id=$1 and actor_id=$2', [inbox, fc])).s), 0);

    const direct = await conversationFor(db, 'garamin_direct_thread', MANAGER_THREAD);
    assert.equal((await one(db, 'select kind from messenger_conversations where id=$1', [direct])).kind, 'direct');
    const manager = await actor(db, 'manager', MANAGER);
    const reads = await call(db, 'select actor_id, last_read_seq from messenger_participants where conversation_id=$1 order by actor_id', [direct]);
    assert.deepEqual(Object.fromEntries(reads.map((r) => [r.actor_id, Number(r.last_read_seq)])), { [fc]: 1, [manager]: 0 });

    const room = await conversationFor(db, 'group_chat_room', ROOM);
    const groupMessages = await seqs(db, room);
    assert.deepEqual(groupMessages.map((m) => [Number(m.seq), m.content, m.reply_to_seq === null ? null : Number(m.reply_to_seq)]),
      [[1, 'notice', null], [2, 'reply', 1]]);
    const participants = await call(db, 'select actor_id, can_send, muted, last_read_seq from messenger_participants where conversation_id=$1', [room]);
    assert.equal(participants.length, 4, 'design managers stay out of the group room');
    const fcRow = participants.find((p) => p.actor_id === fc);
    assert.deepEqual([fcRow.can_send, fcRow.muted, Number(fcRow.last_read_seq)], [true, true, 1]);
    assert.equal(Number((await one(db, 'select pinned_notice_seq s from messenger_conversations where id=$1', [room])).s), 1);
    assert.equal((await one(db, 'select reaction from messenger_reactions where conversation_id=$1', [room])).reaction, '👍');
    const agentPref = await one(db, 'select role, muted from messenger_participants where conversation_id=$1 and actor_id=$2',
      [inbox, await actor(db, 'admin', ADMIN)]);
    assert.deepEqual(agentPref, { role: 'agent', muted: true });

    const reconcile = (await one(db, 'select messenger_reconcile_v1() r')).r;
    assert.equal(reconcile.ok, true, JSON.stringify(reconcile));
  } finally { await db.close(); }
});

test('backfill is idempotent', async () => {
  const db = await fixture();
  try {
    await one(db, 'select messenger_backfill_v1() r');
    const count = async () => (await one(db, `select (select count(*) from messenger_messages)::int m,
      (select count(*) from messenger_actors)::int a, (select count(*) from messenger_conversations)::int c,
      (select count(*) from messenger_sync_issues)::int i`));
    const before = await count();
    await one(db, 'select messenger_backfill_v1() r');
    assert.deepEqual(await count(), before);
  } finally { await db.close(); }
});

test('dual-write triggers mirror inserts, reads, deletes, reactions and notices', async () => {
  const db = await fixture();
  try {
    await one(db, 'select messenger_backfill_v1() r');
    const direct = await conversationFor(db, 'garamin_direct_thread', MANAGER_THREAD);
    const room = await conversationFor(db, 'group_chat_room', ROOM);
    const fc = await actor(db, 'fc', FC);
    const manager = await actor(db, 'manager', MANAGER);

    await call(db, `insert into messages(id, sender_id, receiver_id, content, sender_actor_id, thread_id)
      values ($1, $2, $3, 'live message', $4, $5)`, [id(105), PHONE.manager, PHONE.fc, MANAGER, MANAGER_THREAD]);
    assert.deepEqual((await seqs(db, direct)).map((m) => [Number(m.seq), m.sender_actor_id]).at(-1), [3, manager]);

    await call(db, 'update messages set is_read = true where id = $1', [id(105)]);
    assert.equal(Number((await one(db, 'select last_read_seq s from messenger_participants where conversation_id=$1 and actor_id=$2', [direct, fc])).s), 3);

    await call(db, 'update messages set deleted_at = now(), deleted_by_actor_id = $2 where id = $1', [id(105), MANAGER]);
    const deleteEvent = await one(db, `select type, message_seq, actor_id from messenger_events
      where conversation_id=$1 order by event_seq desc limit 1`, [direct]);
    assert.deepEqual([deleteEvent.type, Number(deleteEvent.message_seq), deleteEvent.actor_id], ['delete', 3, manager]);
    assert.notEqual((await one(db, 'select deleted_at from messenger_messages where id=$1', [id(105)])).deleted_at, null);

    await call(db, `insert into group_chat_messages(id, room_id, sender_actor_id, sender_role, sender_phone, content, reply_to_message_id)
      values ($1, $2, $3, 'admin', $4, 'admin reply', $5)`, [id(203), ROOM, `admin:${PHONE.admin}`, PHONE.admin, id(202)]);
    const last = (await seqs(db, room)).at(-1);
    assert.deepEqual([last.content, Number(last.reply_to_seq)], ['admin reply', 2]);
    assert.equal(Number(last.seq) > 2, true, 'group sequence keeps growing after backfill');

    await call(db, `insert into group_chat_reads values ($1, $2, now(), $3)
      on conflict (room_id, actor_id) do update set last_read_message_id = excluded.last_read_message_id`, [ROOM, `fc:${PHONE.fc}`, id(203)]);
    assert.equal(Number((await one(db, 'select last_read_seq s from messenger_participants where conversation_id=$1 and actor_id=$2', [room, fc])).s), Number(last.seq));

    await call(db, 'delete from group_chat_reactions where message_id = $1', [id(201)]);
    assert.equal((await one(db, 'select count(*)::int n from messenger_reactions where conversation_id=$1', [room])).n, 0);
    await call(db, 'update group_chat_notices set message_id = $2 where room_id = $1', [ROOM, id(203)]);
    assert.equal(Number((await one(db, 'select pinned_notice_seq s from messenger_conversations where id=$1', [room])).s), Number(last.seq));

    assert.equal((await one(db, 'select count(*)::int n from messenger_sync_issues')).n, 0);
    assert.equal((await one(db, 'select messenger_reconcile_v1() r')).r.ok, true);
  } finally { await db.close(); }
});

test('mirroring never blocks the legacy write and skips unmapped rooms', async () => {
  const db = await fixture();
  try {
    await call(db, `insert into messages(id, sender_id, receiver_id, content, sender_actor_id, thread_id)
      values ($1, $2, $3, 'before backfill', $4, $5)`, [id(106), PHONE.manager, PHONE.fc, MANAGER, MANAGER_THREAD]);
    assert.equal((await one(db, 'select count(*)::int n from messenger_messages')).n, 0);
    await one(db, 'select messenger_backfill_v1() r');
    assert.equal((await one(db, 'select count(*)::int n from messenger_messages where id=$1', [id(106)])).n, 1);

    // Force a mirroring failure: the id already exists in another conversation.
    const inbox = await conversationFor(db, 'garamin_direct_thread', INBOX_THREAD);
    await call(db, `select messenger_append_message($1, $2, null, null, 'text', 'squatter', now())`, [inbox, id(107)]);
    await call(db, `insert into messages(id, sender_id, receiver_id, content, sender_actor_id, thread_id)
      values ($1, $2, $3, 'legacy still lands', $4, $5)`, [id(107), PHONE.manager, PHONE.fc, MANAGER, MANAGER_THREAD]);
    assert.equal((await one(db, 'select content from messages where id=$1', [id(107)])).content, 'legacy still lands');
    const issue = await one(db, "select reason, detail->>'error' error from messenger_sync_issues where source_key=$1", [id(107)]);
    assert.deepEqual(issue, { reason: 'mirror_insert_failed', error: 'messenger_message_conversation_conflict' });
    assert.equal((await one(db, 'select messenger_reconcile_v1() r')).r.ok, false, 'reconcile reports the gap');
  } finally { await db.close(); }
});

test('access, first-contact and approval rules follow the 2026-10-16 decisions', async () => {
  const db = await fixture();
  try {
    await one(db, 'select messenger_backfill_v1() r');
    const inbox = await conversationFor(db, 'garamin_direct_thread', INBOX_THREAD);
    const fc = await actor(db, 'fc', FC);
    const admin = await actor(db, 'admin', ADMIN);
    const consumer = await actor(db, 'platform_member', CONSUMER);
    const other = await actor(db, 'platform_member', OTHER_CONSUMER);
    const can = async (who, conversation) => (await one(db, 'select messenger_can_access($1,$2) ok', [who, conversation])).ok;
    assert.equal(await can(fc, inbox), true);
    assert.equal(await can(admin, inbox), true, 'approved Garam staff read the Garam inbox room');
    assert.equal(await can(consumer, inbox), false);

    const partnerOrg = (await one(db, 'select id from messenger_orgs where partner_id=$1', [PARTNER])).id;
    const agent = (await one(db, "insert into messenger_actors(display_name) values ('Synthetic Agent') returning id")).id;
    await call(db, "insert into messenger_org_members(org_id, actor_id, role) values ($1, $2, 'agent')", [partnerOrg, agent]);
    const start = async (who, subject) => (await one(db, 'select messenger_can_start_org_room($1,$2,$3) ok', [who, partnerOrg, subject])).ok;
    assert.equal(await start(agent, consumer), false, 'pending agents cannot start rooms');

    await assert.rejects(call(db, "select messenger_decide_org_member($1,$2,$3,'agent',true)", [admin, partnerOrg, agent]), /messenger_approver_forbidden/);
    await call(db, 'insert into messenger_member_approvers(actor_id) values ($1)', [admin]);
    await call(db, "select messenger_decide_org_member($1,$2,$3,'agent',true)", [admin, partnerOrg, agent]);
    assert.equal(await start(agent, consumer), true, 'agents may contact customers who applied for the service');
    assert.equal(await start(agent, other), false, 'but not members who never applied');
    assert.equal(await start(other, other), true, 'customers may always contact an active partner');

    const room = (await one(db, `insert into messenger_conversations(kind, owner_org_id, subject_actor_id)
      values ('org_room', $1, $2) returning id`, [partnerOrg, consumer])).id;
    await call(db, 'insert into messenger_conversation_orgs(conversation_id, org_id) values ($1, $2)', [room, partnerOrg]);
    await call(db, "insert into messenger_participants(conversation_id, actor_id, role, blocked_at) values ($1, $2, 'subject', now())", [room, consumer]);
    assert.equal(await start(agent, consumer), false, 'a block stops new contact');
    assert.equal(await can(agent, room), true);
    await call(db, "select messenger_decide_org_member($1,$2,$3,'agent',false)", [admin, partnerOrg, agent]);
    assert.equal(await can(agent, room), false, 'revoked agents lose access at once');
  } finally { await db.close(); }
});

test('only service_role can touch unified messenger tables and functions', async () => {
  const db = await fixture();
  try {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from messenger_messages'), /permission denied/);
      await assert.rejects(db.query('select messenger_backfill_v1()'), /permission denied/);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});

test('thread-less messages are placed by phone, interleaved by time, or skipped with a record', async () => {
  const db = await fixture();
  try {
    const DUAL_FC = id(6), DUAL_MANAGER = id(7), DUAL_PHONE = '01000000007';
    await db.exec(`
      insert into fc_profiles values ('${DUAL_FC}', 'Synthetic Dual', '가람지사', '${DUAL_PHONE}', true, false, null);
      insert into manager_accounts values ('${DUAL_MANAGER}', 'Synthetic Dual', '${DUAL_PHONE}', true);
      insert into messages(id, sender_id, receiver_id, content, created_at, is_read) values
        ('${id(301)}', '${PHONE.fc}', '${PHONE.manager}', 'orphan inside thread room', '2026-10-01T00:01:00Z', true),
        ('${id(302)}', '${PHONE.fc}', '${DUAL_PHONE}', 'orphan to dual person', '2026-10-01T00:03:00Z', false),
        ('${id(303)}', 'admin', '01099999999', 'to a withdrawn FC', '2026-10-01T00:04:00Z', false);
      insert into messages(id, sender_id, receiver_id, content, created_at, deleted_at) values
        ('${id(304)}', '${PHONE.developer}', '${PHONE.fc}', 'deleted orphan', '2026-10-01T00:05:00Z', now());
    `);
    const result = (await one(db, 'select messenger_backfill_v1() r')).r;
    assert.deepEqual(result.orphans, { placed: 2, skipped: 2 });

    const fc = await actor(db, 'fc', FC);
    const dual = await actor(db, 'fc', DUAL_FC);
    assert.equal(await actor(db, 'manager', DUAL_MANAGER), dual, 'FC and manager accounts on one phone are one person');

    const direct = await conversationFor(db, 'garamin_direct_thread', MANAGER_THREAD);
    assert.deepEqual((await seqs(db, direct)).map((m) => [Number(m.seq), m.content]),
      [[1, 'manager to fc'], [2, 'orphan inside thread room'], [3, 'fc to manager']], 'placed messages interleave by time');

    const dualRoom = (await one(db, `select c.id, c.kind from messenger_conversations c
      join messenger_orphan_placements p on p.conversation_id = c.id where p.message_id = $1`, [id(302)]));
    assert.equal(dualRoom.kind, 'direct');
    const dualParticipants = await call(db, 'select actor_id from messenger_participants where conversation_id=$1 order by actor_id', [dualRoom.id]);
    assert.deepEqual(dualParticipants.map((p) => p.actor_id).sort(), [fc, dual].sort());

    const skipped = await call(db, `select source_key, reason from messenger_sync_issues
      where reason like 'orphan%' order by source_key`);
    assert.deepEqual(skipped, [
      { source_key: id(303), reason: 'orphan_participant_missing' },
      { source_key: id(304), reason: 'orphan_deleted_skipped' },
    ]);
    assert.equal((await one(db, 'select count(*)::int n from messenger_messages where id = any($1)', [[id(303), id(304)]])).n, 0);

    await one(db, 'select messenger_backfill_v1() r');
    assert.equal((await one(db, 'select count(*)::int n from messenger_sync_issues where reason like $1', ['orphan%'])).n, 2, 'skips are recorded once');
    const reconcile = (await one(db, 'select messenger_reconcile_v1() r')).r;
    assert.equal(reconcile.ok, true, JSON.stringify(reconcile));
    assert.equal(reconcile.unhandledOrphanMessages, 0);
    assert.equal(reconcile.skippedOrphanMessages, 2);
  } finally { await db.close(); }
});

test('an empty thread whose staff account is gone is recorded, and blocks again once it has messages', async () => {
  const db = await fixture();
  try {
    const GONE_MANAGER = id(8), GONE_THREAD = id(34);
    await db.exec(`insert into garamin_direct_threads(id, legacy_conversation_id, counterparty_role, counterparty_actor_id)
      values ('${GONE_THREAD}', '${CONVERSATION}', 'manager', '${GONE_MANAGER}');`);
    await one(db, 'select messenger_backfill_v1() r');
    await one(db, 'select messenger_backfill_v1() r');
    assert.deepEqual(await call(db, 'select reason, resolved_at is null as open from messenger_sync_issues where source_key=$1', [GONE_THREAD]),
      [{ reason: 'thread_counterparty_missing_empty', open: true }], 'recorded once, never as a blocking issue');
    const first = (await one(db, 'select messenger_reconcile_v1() r')).r;
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual([first.unmappedDirectThreads, first.skippedEmptyThreads, first.openIssues], [0, 1, 0]);

    await call(db, `insert into messages(id, sender_id, receiver_id, content, sender_actor_id, thread_id)
      values ($1, $2, '01000000008', 'late message', $3, $4)`, [id(108), PHONE.fc, FC, GONE_THREAD]);
    const second = (await one(db, 'select messenger_reconcile_v1() r')).r;
    assert.equal(second.ok, false, 'a message in the thread makes it block again');
    assert.deepEqual([second.unmappedDirectThreads, second.skippedEmptyThreads], [1, 0]);
    await one(db, 'select messenger_backfill_v1() r');
    assert.equal((await one(db, "select count(*)::int n from messenger_sync_issues where source_key=$1 and reason='staff_actor_missing' and resolved_at is null", [GONE_THREAD])).n, 1);
  } finally { await db.close(); }
});

test('daily sync backfills, reconciles, keeps a pass streak and records failures', async () => {
  const db = await fixture();
  try {
    const first = (await one(db, 'select messenger_daily_sync_v1() r')).r;
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.backfill.directMessagesAdded, 4);
    assert.equal(typeof first.elapsedMs, 'number');

    await call(db, `insert into messages(id, sender_id, receiver_id, content, sender_actor_id, thread_id)
      values ($1, $2, $3, 'arrives between runs', $4, $5)`, [id(109), PHONE.manager, PHONE.fc, MANAGER, MANAGER_THREAD]);
    const second = (await one(db, 'select messenger_daily_sync_v1() r')).r;
    assert.equal(second.ok, true);
    assert.equal(second.backfill.directMessagesAdded, 0, 'the dual-write trigger already mirrored it');
    assert.equal((await one(db, 'select messenger_reconcile_streak_v1() n')).n, 2);

    await db.exec(`create or replace function public.messenger_reconcile_v1() returns jsonb
      language plpgsql as $$ begin raise exception 'forced reconcile failure'; end $$;`);
    const failed = (await one(db, 'select messenger_daily_sync_v1() r')).r;
    await db.exec(backfillMigration);
    assert.equal(failed.ok, false);
    assert.match(failed.error, /forced reconcile failure/);
    const lastRun = await one(db, 'select ok, result->>\'stage\' as stage from messenger_reconcile_runs order by id desc limit 1');
    assert.deepEqual(lastRun, { ok: false, stage: 'daily_sync' });
    assert.equal((await one(db, 'select messenger_reconcile_streak_v1() n')).n, 0, 'a failure resets the streak');

    assert.equal((await one(db, 'select messenger_daily_sync_v1() r')).r.ok, true);
    assert.equal((await one(db, 'select messenger_reconcile_streak_v1() n')).n, 1);
  } finally { await db.close(); }
});

test('daily sync is scheduled once a day at 03:30 KST and service_role only', async () => {
  assert.match(dailySyncSchedule, /create extension if not exists pg_cron with schema pg_catalog;/);
  assert.match(dailySyncSchedule, /cron\.unschedule\(jobid\) from cron\.job where jobname = 'messenger-unified-daily-sync'/);
  assert.match(dailySyncSchedule, /cron\.schedule\('messenger-unified-daily-sync', '30 18 \* \* \*',\s*'select public\.messenger_daily_sync_v1\(\);'\)/);
  const db = await fixture();
  try {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select messenger_daily_sync_v1()'), /permission denied/);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});

test('rehearsal script refuses unmarked databases and runs end to end on a marked copy', async () => {
  const rehearsal = await readFile(new URL('../../scripts/ops/messenger-stage1-rehearsal.sql', import.meta.url), 'utf8');
  const db = await fixture();
  try {
    await assert.rejects(db.exec(rehearsal), /not a rehearsal database/);
    assert.equal((await one(db, 'select count(*)::int n from messenger_messages')).n, 0, 'nothing ran before the guard');
    await db.exec('create table messenger_rehearsal_marker (restored_at timestamptz primary key default now()); insert into messenger_rehearsal_marker default values;');
    await db.exec(rehearsal);
    assert.equal((await one(db, 'select count(*)::int n from messenger_messages')).n, 6);
    assert.equal((await one(db, "select count(*)::int n from messenger_messages where content like 'rehearsal%'")).n, 0, 'probe rolled back');
    assert.equal((await one(db, "select count(*)::int n from messages where content like 'rehearsal%'")).n, 0, 'legacy probe rolled back');
    assert.equal((await db.query('select mirrored from rehearsal_probe')).rows[0].mirrored, 1, 'the probe was mirrored before the rollback');
  } finally { await db.close(); }
});

test('GaramLink import merges people by phone and keeps one room per pair', async () => {
  const db = await fixture();
  try {
    await one(db, 'select messenger_backfill_v1() r');
    const payload = {
      users: [{ id: 1, phone: PHONE.fc, name: 'Synthetic FC' }, { id: 2, phone: '01000000099', name: 'Synthetic GaramLink Designer' }],
      messages: [
        { source: 'request', id: 7, senderUserId: 1, peerUserId: 2, requestId: 3, content: 'request hello', createdAt: '2026-10-02T00:00:00Z', isRead: true },
        { source: 'direct', id: 9, senderUserId: 2, peerUserId: 1, directConversationId: 5, content: 'direct hello', createdAt: '2026-10-02T00:01:00Z', isRead: false },
      ],
    };
    assert.deepEqual((await one(db, 'select messenger_import_request_board_v1($1) r', [payload])).r, { users: 2, messages: 2 });
    await one(db, 'select messenger_import_request_board_v1($1) r', [payload]);

    const fc = await actor(db, 'fc', FC);
    assert.equal(await actor(db, 'request_board_user', '1'), fc, 'GaramLink user with the FC phone is the same person');
    const pair = await conversationFor(db, 'request_board_pair', '1:2');
    assert.equal(await conversationFor(db, 'request_board_direct', '5'), pair, 'request and direct chats share one room');
    const messages = await seqs(db, pair);
    assert.deepEqual(messages.map((m) => m.content), ['request hello', 'direct hello']);
    assert.deepEqual((await one(db, 'select context from messenger_messages where conversation_id=$1 and seq=1', [pair])).context,
      { requestBoard: { requestId: 3 } });
    const designer = await actor(db, 'request_board_user', '2');
    assert.equal(Number((await one(db, 'select last_read_seq s from messenger_participants where conversation_id=$1 and actor_id=$2', [pair, designer])).s), 1);
  } finally { await db.close(); }
});

test('GaramLink batch import moves the cursor with the batch and refuses stale cursors', async () => {
  const db = await fixture();
  try {
    await one(db, 'select messenger_backfill_v1() r');
    const users = [{ id: 1, phone: PHONE.fc, name: 'Synthetic FC' }, { id: 2, phone: '01000000099', name: 'Synthetic GaramLink Designer' }];
    const first = { users, messages: [
      { source: 'request', id: 7, senderUserId: 1, peerUserId: 2, requestId: 3, content: 'one', createdAt: '2026-10-02T00:00:00Z', isRead: false },
    ] };
    const c1 = { createdAt: '2026-10-02T00:00:00+00:00', source: 'request', id: 7 };
    const c2 = { createdAt: '2026-10-02T00:01:00+00:00', source: 'direct', id: 9 };
    const r1 = (await one(db, 'select messenger_import_request_board_batch_v1($1, null, $2) r', [first, c1])).r;
    assert.deepEqual(r1, { users: 2, messages: 1, cursor: c1 });

    const second = { users, messages: [
      { source: 'direct', id: 9, senderUserId: 2, peerUserId: 1, directConversationId: 5, content: 'two', createdAt: '2026-10-02T00:01:00Z', isRead: false },
    ] };
    await assert.rejects(call(db, 'select messenger_import_request_board_batch_v1($1, null, $2)', [second, c2]), /cursor_conflict/);
    const pair = await conversationFor(db, 'request_board_pair', '1:2');
    assert.deepEqual((await seqs(db, pair)).map((m) => m.content), ['one'], 'a refused batch imports nothing');

    await one(db, 'select messenger_import_request_board_batch_v1($1, $2, $3) r', [second, c1, c2]);
    assert.deepEqual((await seqs(db, pair)).map((m) => m.content), ['one', 'two']);
    const row = await one(db, "select cursor, batches::int b, messages::int m, last_error from messenger_import_cursors where source='request_board'");
    assert.deepEqual(row, { cursor: c2, b: 2, m: 2, last_error: null });

    await one(db, "select messenger_import_record_error_v1('request_board', 'garamlink_export_http_503') r");
    const failed = await one(db, "select cursor, last_error from messenger_import_cursors where source='request_board'");
    assert.deepEqual(failed, { cursor: c2, last_error: 'garamlink_export_http_503' }, 'an error keeps the cursor');
    await one(db, 'select messenger_import_request_board_batch_v1($1, $2, $3) r', [{ users: [], messages: [] }, c2, c2]);
    assert.equal((await one(db, "select last_error from messenger_import_cursors where source='request_board'")).last_error, null);
  } finally { await db.close(); }
});

test('GaramLink sync is service_role only and scheduled every 10 minutes through Vault', async () => {
  assert.match(garamLinkSyncSchedule, /vault\.decrypted_secrets\s+where name = 'messenger_garamlink_sync_service_key'/);
  assert.match(garamLinkSyncSchedule, /if coalesce\(service_key, ''\) = '' then return null; end if;/);
  assert.match(garamLinkSyncSchedule, /functions\/v1\/messenger-garamlink-sync/);
  assert.match(garamLinkSyncSchedule, /revoke all on function public\.request_messenger_garamlink_sync_v1\(\) from public, anon, authenticated, service_role;/);
  assert.match(garamLinkSyncSchedule, /cron\.schedule\('messenger-garamlink-sync', '\*\/10 \* \* \* \*',\s*'select public\.request_messenger_garamlink_sync_v1\(\);'\)/);
  const db = await fixture();
  try {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select messenger_import_request_board_batch_v1('{}'::jsonb, null, null)"), /permission denied/);
      await assert.rejects(db.query('select * from messenger_import_cursors'), /permission denied/);
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});
