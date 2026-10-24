// Real SQL in an isolated in-memory PostgreSQL engine: no credentials or network.
// The fixture reproduces the production grants and policy texts that the stage 0
// anon lockdown changes, then replays the app's query shapes as role anon.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';

const { PGlite } = createRequire(import.meta.url)(process.env.PGLITE_MODULE_PATH ?? '@electric-sql/pglite');
const migration = await readFile(new URL('../migrations/20261024120000_revoke_unused_anon_privileges.sql', import.meta.url), 'utf8');
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');

const FC_A = '30000000-0000-4000-8000-00000000000a';
const FC_B = '30000000-0000-4000-8000-00000000000b';
const ROUND = '20000000-0000-4000-8000-000000000001';
const LOCATION = '21000000-0000-4000-8000-000000000001';

// Production fc_profiles columns (information_schema, 2026-10-24).
const FC_PROFILE_COLUMNS = `account_closed_at address address_detail admin_memo affiliation allowance_date
  allowance_prescreen_requested_at allowance_reject_reason appointment_date appointment_date_life
  appointment_date_life_sub appointment_date_nonlife appointment_date_nonlife_sub appointment_reject_reason_life
  appointment_reject_reason_nonlife appointment_schedule_life appointment_schedule_nonlife appointment_url career_type
  carrier created_at dawichok_url_sent_at dawichok_url_sent_by docs_deadline_at docs_deadline_last_notified_at email
  hanwha_commission_date hanwha_commission_date_sub hanwha_commission_pdf_name hanwha_commission_pdf_path
  hanwha_commission_reject_reason id identity_completed is_manager_referral_shadow is_tour_seen license_statuses
  life_commission_completed name nonlife_commission_completed phone phone_verification_attempts
  phone_verification_challenge_id phone_verification_delivery_id phone_verification_expires_at phone_verification_hash
  phone_verification_locked_until phone_verification_sent_at phone_verified phone_verified_at recommender
  recommender_code recommender_code_id recommender_fc_id recommender_link_source recommender_linked_at resident_id_hash
  resident_id_masked signup_completed signup_verification_method signup_verification_proof_expires_at
  signup_verification_proof_hash signup_verified_at signup_verified_by_admin_id status temp_id updated_at`.split(/\s+/);
const HIDDEN_FROM_ANON = ['admin_memo', 'resident_id_hash', 'phone_verification_hash', 'phone_verification_challenge_id',
  'signup_verification_proof_hash', 'recommender_code', 'account_closed_at', 'updated_at'];

const PRODUCTION_FIXTURE = `
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth;
  create function auth.role() returns text language sql stable as $$ select current_user::text $$;
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  grant usage on schema auth, public to anon, authenticated, service_role;

  -- profiles.id = auth.uid() helpers; never true for anon.
  create function public.is_admin() returns boolean language sql stable security definer as $$ select false $$;
  create function public.is_manager() returns boolean language sql stable security definer as $$ select false $$;
  create function public.is_fc() returns boolean language sql stable security definer as $$ select false $$;
  create function public.current_fc_id() returns uuid language sql stable security definer as $$ select null::uuid $$;
  create function public.set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at = now(); return new; end $$;
  create sequence public.temp_id_seq;
  create function public.generate_temp_id() returns text language sql security definer
    as $$ select 'T' || nextval('public.temp_id_seq') $$;

  create table public.fc_profiles (${FC_PROFILE_COLUMNS.map((c) => (c === 'id' ? 'id uuid primary key'
    : c === 'created_at' ? 'created_at timestamptz not null default now()' : `${c} text`)).join(', ')});
  create table public.fc_documents (
    id uuid primary key default gen_random_uuid(), fc_id uuid not null references public.fc_profiles(id),
    doc_type text not null, storage_path text, file_name text, status text not null default 'pending',
    reviewer_note text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (fc_id, doc_type)
  );
  create trigger trg_fc_documents_updated_at before update on public.fc_documents
    for each row execute function public.set_updated_at();
  create table public.exam_rounds (
    id uuid primary key, exam_type text not null, exam_month date, exam_date date, registration_deadline date,
    round_label text, notes text, created_at timestamptz default now(), updated_at timestamptz default now(),
    unique (id, exam_type)
  );
  create table public.exam_locations (
    id uuid primary key, round_id uuid references public.exam_rounds(id), location_name text, sort_order int,
    created_at timestamptz default now(), updated_at timestamptz default now(), unique (id, round_id)
  );
  create table public.exam_registrations (
    id uuid primary key, resident_id text, round_id uuid, location_id uuid, exam_type text, exam_month date,
    status text, is_confirmed boolean, includes_primary_exam boolean, is_third_exam boolean, fee_paid_date date,
    payment_proof_attached boolean, rejection_reason text, rejected_at timestamptz, created_at timestamptz default now(),
    fc_id uuid, memo text, admin_memo text, updated_at timestamptz, payment_proof_policy_version smallint,
    monthly_slot_policy_version smallint, rejected_by_admin_id uuid, rejected_by_staff_type text,
    constraint exam_registrations_round_exam_type_fkey foreign key (round_id, exam_type) references public.exam_rounds(id, exam_type),
    constraint exam_registrations_location_round_fkey foreign key (location_id, round_id) references public.exam_locations(id, round_id)
  );
  create table public.notices (id uuid primary key default gen_random_uuid(), title text, body text);
  create table public.notifications (id uuid primary key default gen_random_uuid(), title text);
  create table public.group_chat_rooms (id uuid primary key default gen_random_uuid(), name text);
  create table public.group_chat_messages (id uuid primary key default gen_random_uuid(), room_id uuid, body text);
  create table public.fc_identity_secure (fc_id uuid primary key, resident_number_encrypted text);
  create table public.web_push_subscriptions (id uuid primary key default gen_random_uuid(), endpoint text);
  create table public.board_posts (id uuid primary key default gen_random_uuid(), title text);
  create view public.board_posts_with_stats with (security_invoker = true) as select id, title from public.board_posts;

  alter table public.fc_profiles enable row level security;
  alter table public.fc_documents enable row level security;
  alter table public.exam_rounds enable row level security;
  alter table public.exam_locations enable row level security;
  alter table public.exam_registrations enable row level security;
  alter table public.notices enable row level security;
  alter table public.notifications enable row level security;
  alter table public.group_chat_rooms enable row level security;
  alter table public.group_chat_messages enable row level security;
  alter table public.fc_identity_secure enable row level security;
  alter table public.web_push_subscriptions enable row level security;
  alter table public.board_posts enable row level security;

  -- Production policy texts (pg_policies, 2026-10-24).
  create policy "fc_profiles select" on public.fc_profiles for select
    using ((auth.role() = 'anon'::text) OR is_admin() OR is_manager() OR (is_fc() AND (id = current_fc_id())));
  create policy "fc_profiles insert" on public.fc_profiles for insert with check (is_admin() OR is_fc());
  create policy "fc_profiles update" on public.fc_profiles for update
    using (is_admin() OR (is_fc() AND (id = current_fc_id()))) with check (is_admin() OR (is_fc() AND (id = current_fc_id())));
  create policy "fc_profiles delete" on public.fc_profiles for delete using (is_admin());
  create policy "fc_documents anon select" on public.fc_documents for select using (auth.role() = 'anon'::text);
  create policy "fc_documents anon insert" on public.fc_documents for insert with check (auth.role() = 'anon'::text);
  create policy "fc_documents anon update" on public.fc_documents for update
    using (auth.role() = 'anon'::text) with check (auth.role() = 'anon'::text);
  create policy "fc_documents delete" on public.fc_documents for delete
    using (auth.role() = ANY (ARRAY['authenticated'::text, 'anon'::text]));
  create policy "fc_documents select" on public.fc_documents for select
    using (is_admin() OR is_manager() OR (is_fc() AND (fc_id = current_fc_id())));
  create policy "exam_rounds select" on public.exam_rounds for select
    using ((auth.role() = 'anon'::text) OR is_admin() OR is_manager() OR is_fc());
  create policy "exam_locations select" on public.exam_locations for select
    using ((auth.role() = 'anon'::text) OR is_admin() OR is_manager() OR is_fc());
  create policy "exam_registrations select" on public.exam_registrations for select
    using ((auth.role() = 'anon'::text) OR is_admin() OR is_manager() OR (is_fc() AND (fc_id = current_fc_id())));
  create policy "exam_registrations anon insert" on public.exam_registrations for insert with check (auth.role() = 'anon'::text);
  create policy "exam_registrations anon update" on public.exam_registrations for update using (auth.role() = 'anon'::text);
  create policy "exam_registrations anon delete" on public.exam_registrations for delete using (auth.role() = 'anon'::text);
  create policy "notices select" on public.notices for select using (is_admin() OR is_manager() OR is_fc());
  create policy "notices delete" on public.notices for delete
    using (auth.role() = ANY (ARRAY['authenticated'::text, 'anon'::text]));
  create policy "notifications delete" on public.notifications for delete
    using (auth.role() = ANY (ARRAY['authenticated'::text, 'anon'::text]));
  create policy "group_chat_messages service role" on public.group_chat_messages for all
    using (auth.role() = 'service_role'::text) with check (auth.role() = 'service_role'::text);
  create policy "group_chat_rooms service role" on public.group_chat_rooms for all
    using (auth.role() = 'service_role'::text) with check (auth.role() = 'service_role'::text);
  create policy "fc_identity_secure select" on public.fc_identity_secure for select
    using (is_admin() OR (is_fc() AND (fc_id = current_fc_id())));
  create policy "web_push_subscriptions select" on public.web_push_subscriptions for select
    using (is_admin() OR is_manager() OR is_fc());
  create policy "board_posts service_role" on public.board_posts for all
    using (auth.role() = 'service_role'::text) with check (auth.role() = 'service_role'::text);

  -- Production table grants: Supabase defaults gave anon/authenticated everything,
  -- and pg_default_acl keeps doing so for tables postgres creates later.
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant all on all sequences in schema public to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

  create schema storage;
  grant usage on schema storage to anon, authenticated, service_role;
  create table storage.buckets (id text primary key, public boolean not null default false, file_size_limit bigint);
  insert into storage.buckets (id, public) values ('notice-attachments', true), ('fc-documents', false), ('chat-uploads', true);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid
  );
  alter table storage.objects enable row level security;
  grant all on storage.objects to anon, authenticated, service_role;
  create policy "Allow Absolutely All Notice Attachments" on storage.objects for all
    using (bucket_id = 'notice-attachments'::text) with check (bucket_id = 'notice-attachments'::text);
  create policy "chat-uploads insert" on storage.objects for insert with check (bucket_id = 'chat-uploads'::text);
  create policy "chat-uploads select" on storage.objects for select using (bucket_id = 'chat-uploads'::text);
  create policy "chat-uploads write" on storage.objects for insert
    with check ((bucket_id = 'chat-uploads'::text) AND (is_admin() OR is_manager() OR is_fc()));
  create policy "chat-uploads delete" on storage.objects for delete
    using ((bucket_id = 'chat-uploads'::text) AND (is_admin() OR is_manager() OR is_fc()));
  create policy "fc-documents anon read" on storage.objects for select using (bucket_id = 'fc-documents'::text);
  create policy "fc-documents anon write" on storage.objects for insert with check (bucket_id = 'fc-documents'::text);

  insert into public.fc_profiles (id, name, phone, status, temp_id, admin_memo, phone_verification_hash)
    values ('${FC_A}', 'A', '01000000001', 'docs-requested', 'T1', 'memo', 'hash'),
           ('${FC_B}', 'B', '01000000002', 'draft', null, null, null);
  insert into public.exam_rounds (id, exam_type, exam_date, registration_deadline, round_label)
    values ('${ROUND}', 'life', '2026-11-01', '2026-10-25', '11월 1차');
  insert into public.exam_locations (id, round_id, location_name, sort_order) values ('${LOCATION}', '${ROUND}', '서울', 1);
  insert into public.exam_registrations (id, resident_id, round_id, location_id, exam_type, status, is_confirmed, fc_id, admin_memo)
    values ('10000000-0000-4000-8000-000000000001', '01000000001', '${ROUND}', '${LOCATION}', 'life', 'applied', false, '${FC_A}', 'x');
  insert into public.notices (title) values ('공지');
`;

async function withDb(run) {
  const db = new PGlite();
  try {
    await db.exec(PRODUCTION_FIXTURE);
    await db.exec(migration);
    await db.exec(migration); // re-runnable
    await run(db);
  } finally {
    await db.close();
  }
}

async function asRole(db, role, sql) {
  await db.exec(`set role ${role}`);
  try {
    return await db.query(sql);
  } finally {
    await db.exec('reset role');
  }
}

const anon = (db, sql) => asRole(db, 'anon', sql);

// PostgREST embeds a to-many relation as a correlated json_agg subquery.
const embedDocuments = (columns) => `coalesce((select json_agg(d) from (select ${columns} from public.fc_documents
  where public.fc_documents.fc_id = public.fc_profiles.id) d), '[]') as fc_documents`;

test('anon keeps every fc_profiles column the app reads and loses the sensitive ones', async () => {
  await withDb(async (db) => {
    // Mobile home (app/index.tsx:416), consent (app/consent.tsx:113) and staff dashboard (app/dashboard.tsx:545) shapes.
    const home = await anon(db, `select id,name,affiliation,phone,status,temp_id,license_statuses,allowance_date,
      allowance_prescreen_requested_at,allowance_reject_reason,hanwha_commission_date_sub,hanwha_commission_date,
      hanwha_commission_reject_reason,hanwha_commission_pdf_path,hanwha_commission_pdf_name,appointment_url,appointment_date,
      appointment_schedule_life,appointment_schedule_nonlife,appointment_date_life,appointment_date_nonlife,
      appointment_date_life_sub,appointment_date_nonlife_sub,life_commission_completed,nonlife_commission_completed,
      resident_id_masked,email,address,identity_completed,is_tour_seen,signup_completed,
      ${embedDocuments('doc_type,storage_path,status')} from public.fc_profiles where phone = '01000000001'`);
    assert.equal(home.rows.length, 1);
    await anon(db, `select id, temp_id, allowance_date, career_type, allowance_reject_reason, status
      from public.fc_profiles where phone = '01000000001'`);
    const dashboard = await anon(db, `select id,name,affiliation,phone,recommender,recommender_fc_id,temp_id,status,
      allowance_date,docs_deadline_at,dawichok_url_sent_at,dawichok_url_sent_by,resident_id_masked,career_type,email,
      address,address_detail,${embedDocuments('doc_type,storage_path,file_name,status')}
      from public.fc_profiles where name ilike '%A%' or affiliation ilike '%A%' or phone ilike '%A%' or temp_id ilike '%A%'
      order by created_at desc, id asc limit 50`);
    assert.equal(dashboard.rows.length, 1);

    for (const column of HIDDEN_FROM_ANON) {
      await assert.rejects(anon(db, `select ${column} from public.fc_profiles`), /permission denied/, column);
    }
    await assert.rejects(anon(db, 'select * from public.fc_profiles'), /permission denied/);
    const { rows } = await db.query(`select count(*)::int as n from unnest($1::text[]) c
      where has_column_privilege('anon', 'public.fc_profiles', c, 'SELECT')`, [FC_PROFILE_COLUMNS]);
    assert.equal(rows[0].n, 42);
  });
});

test('legacy fc_profiles writes from anon still end without an error and change nothing', async () => {
  await withDb(async (db) => {
    // Apps up to 4.2.19 still send these; RLS has always matched zero rows.
    const update = await anon(db, `update public.fc_profiles set status = 'docs-pending', hanwha_commission_date = null
      where id = '${FC_A}'`);
    assert.equal(update.affectedRows, 0);
    await anon(db, `update public.fc_profiles set name = 'x', affiliation = 'y', email = 'z', carrier = 'c'
      where id = '${FC_A}'`);
    const { rows } = await db.query(`select status, name from public.fc_profiles where id = '${FC_A}'`);
    assert.deepEqual(rows, [{ status: 'docs-requested', name: 'A' }]);
    await assert.rejects(anon(db, `delete from public.fc_profiles where id = '${FC_A}'`), /permission denied/);
  });
});

test('anon submits its own pending document but cannot approve, repoint or delete', async () => {
  await withDb(async (db) => {
    // app/docs-upload.tsx:448 upsert as PostgREST sends it (RETURNING adds the primary key).
    const upsert = (path, status = 'pending', note = 'null') => anon(db, `
      insert into public.fc_documents (fc_id, doc_type, storage_path, file_name, status, reviewer_note)
      values ('${FC_A}', 'id_card', '${path}', 'a.pdf', '${status}', ${note})
      on conflict (fc_id, doc_type) do update set fc_id = excluded.fc_id, doc_type = excluded.doc_type,
        storage_path = excluded.storage_path, file_name = excluded.file_name, status = excluded.status,
        reviewer_note = excluded.reviewer_note
      returning id, fc_id, doc_type, storage_path, file_name, status, reviewer_note`);
    const created = await upsert(`${FC_A}/abc123.pdf`);
    assert.equal(created.rows[0].status, 'pending');
    await upsert(`${FC_A}/def456.pdf`);
    await anon(db, `select doc_type, storage_path, status, reviewer_note, file_name from public.fc_documents
      where fc_id = '${FC_A}' order by doc_type`);

    await assert.rejects(upsert(`${FC_A}/x.pdf`, 'approved'), /only pending submissions/);
    await assert.rejects(upsert(`${FC_A}/x.pdf`, 'pending', "'ok'"), /only pending submissions/);
    await assert.rejects(upsert(`${FC_B}/x.pdf`), /under the member folder/);
    await assert.rejects(anon(db, `update public.fc_documents set fc_id = '${FC_B}' where fc_id = '${FC_A}'`), /immutable/);
    await assert.rejects(anon(db, `update public.fc_documents set status = 'approved' where fc_id = '${FC_A}'`), /only pending/);
    await assert.rejects(anon(db, `delete from public.fc_documents where fc_id = '${FC_A}'`), /permission denied/);
    await assert.rejects(anon(db, 'select created_at from public.fc_documents'), /permission denied/);

    // Apps up to 4.2.17 remove a file by writing this tombstone.
    await anon(db, `update public.fc_documents set storage_path = 'deleted', file_name = 'deleted.pdf', status = 'pending',
      reviewer_note = null where fc_id = '${FC_A}' and doc_type = 'id_card'`);
    // Review stays with service role.
    await asRole(db, 'service_role', `update public.fc_documents set status = 'approved', reviewer_note = 'ok'
      where fc_id = '${FC_A}'`);
    const { rows } = await db.query(`select storage_path, status from public.fc_documents where fc_id = '${FC_A}'`);
    assert.deepEqual(rows, [{ storage_path: 'deleted', status: 'approved' }]);
  });
});

test('exam schedule stays public and registrations expose only list columns', async () => {
  await withDb(async (db) => {
    // app/exam-register.tsx:106 rounds with locations, app/exam-manage.tsx:97 registrations with both embeds.
    await anon(db, `select r.id, r.exam_month, r.exam_date, r.registration_deadline, r.round_label, r.notes, r.created_at,
      r.updated_at, (select json_agg(l) from public.exam_locations l where l.round_id = r.id) as exam_locations
      from public.exam_rounds r where r.exam_type = 'life'`);
    const managed = await anon(db, `select g.id, g.resident_id, g.status, g.is_confirmed, g.includes_primary_exam,
      g.is_third_exam, g.fee_paid_date, g.rejection_reason, g.created_at, r.exam_type, r.exam_date, r.round_label,
      l.location_name from public.exam_registrations g
      join public.exam_rounds r on r.id = g.round_id and r.exam_type = g.exam_type
      left join public.exam_locations l on l.id = g.location_id and l.round_id = g.round_id
      where r.exam_type = 'life' order by g.created_at desc, g.id asc`);
    assert.equal(managed.rows.length, 1);
    await anon(db, `select id, round_id, location_id, status, is_confirmed, payment_proof_attached, rejected_at, exam_month
      from public.exam_registrations where resident_id = '01000000001'`);
    for (const column of ['fc_id', 'admin_memo', 'memo', 'rejected_by_admin_id']) {
      await assert.rejects(anon(db, `select ${column} from public.exam_registrations`), /permission denied/, column);
    }
    await assert.rejects(anon(db, `insert into public.exam_registrations (id, resident_id) values (gen_random_uuid(), 'x')`),
      /permission denied/);
    await assert.rejects(anon(db, 'truncate public.exam_rounds'), /permission denied/);
  });
});

test('tables no client reads are closed to anon and authenticated', async () => {
  await withDb(async (db) => {
    for (const role of ['anon', 'authenticated']) {
      for (const sql of ['select * from public.notices', 'delete from public.notices', 'select * from public.fc_identity_secure',
        'select * from public.web_push_subscriptions', 'select * from public.board_posts_with_stats',
        'select * from public.group_chat_rooms', 'select * from public.notifications', "select nextval('public.temp_id_seq')"]) {
        await assert.rejects(asRole(db, role, sql), /permission denied/, `${role}: ${sql}`);
      }
      await assert.rejects(asRole(db, role, 'select public.generate_temp_id()'), /permission denied/);
    }
    // The dead group chat subscription keeps a privilege check but sees no rows.
    const chat = await anon(db, 'select id from public.group_chat_messages');
    assert.equal(chat.rows.length, 0);
    const temp = await asRole(db, 'service_role', 'select public.generate_temp_id() as id');
    assert.match(temp.rows[0].id, /^T\d+$/);
    const notices = await asRole(db, 'service_role', 'select count(*)::int as n from public.notices');
    assert.equal(notices.rows[0].n, 1);
  });
});

test('tables and sequences created after the migration start closed to anon and authenticated', async () => {
  await withDb(async (db) => {
    await db.exec('create table public.later_feature (id uuid primary key default gen_random_uuid(), secret text);');
    await db.exec('create sequence public.later_seq;');
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(asRole(db, role, 'select * from public.later_feature'), /permission denied/, role);
      await assert.rejects(asRole(db, role, "select nextval('public.later_seq')"), /permission denied/, role);
    }
    await asRole(db, 'service_role', "insert into public.later_feature (secret) values ('x')");
  });
});

test('notice attachments are upload-only and chat uploads are closed; document storage is unchanged in stage 0', async () => {
  await withDb(async (db) => {
    // app/admin-notice.tsx names "<images|files>/<epoch ms>_..."; the admin web names "<epoch ms>_...".
    await anon(db, `insert into storage.objects (bucket_id, name) values ('notice-attachments', 'images/1729700000000_ab12.png')`);
    await anon(db, `insert into storage.objects (bucket_id, name) values ('notice-attachments', '1729700000001_c0ffee.pdf')`);
    for (const name of ['evil.html', 'images/evil.html', 'other/1729700000000_x.png']) {
      await assert.rejects(anon(db, `insert into storage.objects (bucket_id, name) values ('notice-attachments', '${name}')`),
        /row-level security/, name);
    }
    const listed = await anon(db, `select name from storage.objects where bucket_id = 'notice-attachments'`);
    assert.equal(listed.rows.length, 2);
    const replaced = await anon(db, `update storage.objects set name = 'images/evil.html' where bucket_id = 'notice-attachments'`);
    assert.equal(replaced.affectedRows, 0);
    const removed = await anon(db, `delete from storage.objects where bucket_id = 'notice-attachments'`);
    assert.equal(removed.affectedRows, 0);
    const { rows: buckets } = await db.query(`select id, file_size_limit from storage.buckets order by id`);
    assert.deepEqual(buckets.map((b) => [b.id, b.file_size_limit === null ? null : Number(b.file_size_limit)]),
      [['chat-uploads', null], ['fc-documents', null], ['notice-attachments', 52428800]]);
    await assert.rejects(anon(db, `insert into storage.objects (bucket_id, name) values ('chat-uploads', 'c/1.png')`),
      /row-level security/);
    // Stage 4 moves these behind signed URLs; stage 0 must not break current uploads and viewers.
    await anon(db, `insert into storage.objects (bucket_id, name) values ('fc-documents', '${FC_A}/abc.pdf')`);
    const docs = await anon(db, `select name from storage.objects where bucket_id = 'fc-documents'`);
    assert.equal(docs.rows.length, 1);
  });
});

test('schema snapshot includes the complete stage 0 migration', () => {
  assert.ok(schema.replaceAll('\r\n', '\n').includes(migration.replaceAll('\r\n', '\n')));
});
