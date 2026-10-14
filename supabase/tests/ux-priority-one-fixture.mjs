import { readFile } from 'node:fs/promises';
export const baseMigration = await readFile(new URL('../migrations/20261009065353_ux_priority_one_atomic_mutations.sql', import.meta.url), 'utf8');
export const actorMigration = await readFile(new URL('../migrations/20261013093016_ux_notice_idempotent_actor.sql', import.meta.url), 'utf8');
export const migration = `${baseMigration}\n${actorMigration}`;
export const fc = '10000000-0000-4000-8000-000000000001';
export const round = '20000000-0000-4000-8000-000000000001';
export const category = '30000000-0000-4000-8000-000000000001';
export const request = '40000000-0000-4000-8000-000000000001';
export const fixtureSql = `
create role anon; create role authenticated; create role service_role bypassrls;
create table admin_accounts(phone text primary key, active boolean);
create table manager_accounts(like admin_accounts including all);
create table fc_profiles(id uuid primary key, phone text, signup_completed boolean, is_manager_referral_shadow boolean default false,
 status text, docs_deadline_at date,docs_deadline_last_notified_at date,
 hanwha_commission_date_sub date,hanwha_commission_date date,hanwha_commission_reject_reason text,
 hanwha_commission_pdf_path text,hanwha_commission_pdf_name text,appointment_url text,appointment_date date,
 appointment_schedule_life text,appointment_schedule_nonlife text,appointment_date_life date,appointment_date_nonlife date,
 appointment_date_life_sub date,appointment_date_nonlife_sub date,appointment_reject_reason_life text,
 appointment_reject_reason_nonlife text,life_commission_completed boolean,nonlife_commission_completed boolean);
create table fc_documents(fc_id uuid references fc_profiles,doc_type text,storage_path text,file_name text,status text,reviewer_note text,primary key(fc_id,doc_type));
create table exam_rounds(id uuid primary key);
create table exam_locations(id uuid primary key default gen_random_uuid(),round_id uuid references exam_rounds on delete cascade);
create table exam_registrations(id uuid primary key default gen_random_uuid(),round_id uuid references exam_rounds,location_id uuid references exam_locations);
create table board_categories(id uuid primary key,is_active boolean);
create table board_posts(id uuid primary key default gen_random_uuid(),category_id uuid references board_categories,title text,content text,author_role text,author_resident_id text,author_name text,updated_at timestamptz default now());
create table notices(id uuid primary key default gen_random_uuid(),title text,body text,category text);
grant usage on schema public to anon,authenticated,service_role;
grant all on all tables in schema public to service_role;
insert into admin_accounts values ('00000000001',true),('00000000009',false);
insert into manager_accounts values ('00000000003',true);
insert into fc_profiles(id,phone,signup_completed,status,appointment_url,life_commission_completed,nonlife_commission_completed)
 values('${fc}','00000000002',true,'docs-pending','synthetic-url',true,true);
insert into fc_documents values('${fc}','required','synthetic-path','synthetic.pdf','pending',null);
insert into exam_rounds values('${round}'); insert into exam_locations(round_id) values('${round}');
insert into board_categories values('${category}',true);
`;

// The same bounded synthetic setup supports PGlite behavior tests and the
// existing independent-loopback PostgreSQL concurrency runner.
export async function preparePlatformMembershipFixture(db,{seedSql='',withWithdrawal=false,
  admin='90000000-0000-4000-8000-000000000001',hash=Buffer.alloc(32,3).toString('base64'),
  salt=Buffer.alloc(16,4).toString('base64')}={}) {
  const files={
  "migration": "20261012072525_platform_common_membership.sql",
  "hospitalMigration": "20261012072611_hospital_directory_ad_performance.sql",
  "recoveryMigration": "20261012072614_platform_membership_recovery_consent.sql",
  "smsDeliveryMigration": "20261013094533_moduon_signup_sms_delivery_state.sql",
  "extendedSmsDeliveryMigration": "20261013094539_extend_sms_delivery_tracking.sql",
  "generations": "20261004133155_credential_session_generations.sql",
  "enrollmentMigration": "20261014043557_unified_common_insurance_enrollment.sql",
  "withdrawalMigration": "20261014073458_platform_affiliate_account_withdrawal.sql",
  "accountDeletionMigration": "20260724131931_exam_bundle_monthly_slot_and_decisions.sql",
  "messengerMigration": "20260725035711_add_private_messenger_attachments_v2.sql"
};
  const sources=Object.fromEntries(await Promise.all(Object.entries(files).map(async([key,file])=>
    [key,await readFile(new URL('../migrations/'+file,import.meta.url),'utf8')])));
  const {migration,hospitalMigration,recoveryMigration,smsDeliveryMigration,extendedSmsDeliveryMigration,generations,enrollmentMigration,withdrawalMigration,accountDeletionMigration,messengerMigration}=sources;
  await db.exec(fixtureSql);
  await db.exec(`alter table fc_profiles add column name text default 'Synthetic FC';
    alter table fc_profiles add column recommender_fc_id uuid;
    alter table admin_accounts add column id uuid default gen_random_uuid() unique;
    update admin_accounts set id='${admin}' where phone='00000000001';
    alter table admin_accounts add column staff_type text default 'admin';
    alter table admin_accounts add column name text default 'Synthetic Admin';
    alter table manager_accounts add column id uuid default gen_random_uuid() unique;
    alter table manager_accounts add column name text default 'Synthetic Manager';
    alter table admin_accounts add column password_set_at timestamptz default now();
    alter table admin_accounts add column session_version bigint default 0;
    alter table manager_accounts add column password_set_at timestamptz default now();
    alter table manager_accounts add column session_version bigint default 0;
    alter table fc_profiles alter column id set default gen_random_uuid();
    create unique index on fc_profiles(phone);
    alter table fc_profiles add column affiliation text default '가람';
    alter table fc_profiles add column temp_id text;
    alter table fc_profiles add column identity_completed boolean default false;
    alter table fc_profiles add column email text;
    alter table fc_profiles add column carrier text;
    alter table fc_profiles add column license_statuses text[];
    alter table fc_profiles add column phone_verification_hash text;
    alter table fc_profiles add column phone_verification_expires_at timestamptz;
    alter table fc_profiles add column signup_verification_method text;
    alter table fc_profiles add column signup_verified_at timestamptz;
    alter table fc_profiles add column signup_verified_by_admin_id uuid;
    alter table fc_profiles add column updated_at timestamptz default now();
    alter table fc_profiles add column created_at timestamptz default now();
    create table fc_identity_secure(fc_id uuid primary key references fc_profiles(id) on delete cascade);
    create table fc_credentials(fc_id uuid primary key references fc_profiles(id) on delete cascade,
      password_hash text not null,password_salt text not null,password_set_at timestamptz,session_version bigint not null default 0,
      failed_count integer default 0,locked_until timestamptz,must_change_password boolean default false,
      reset_token_hash text,reset_token_expires_at timestamptz,reset_sent_at timestamptz,reset_failed_count integer default 0,
      created_at timestamptz default now(),updated_at timestamptz default now());
    create table fc_signup_completion_challenges(fc_id uuid primary key references fc_profiles(id) on delete cascade,
      token_hash text,expires_at timestamptz,consumed_at timestamptz,request_fingerprint text,result jsonb,updated_at timestamptz);
    insert into fc_credentials(fc_id,password_hash,password_salt,password_set_at) values('${fc}','${hash}','${salt}',now());
    create table referral_codes(id uuid primary key default gen_random_uuid(),fc_id uuid,code text unique,is_active boolean);
    create function apply_referral_link_state(p_invitee_fc_id uuid,p_inviter_fc_id uuid,p_referral_code_id uuid,
      p_referral_code text,p_source text,p_actor_phone text,p_actor_role text,p_actor_staff_type text,p_reason text)
      returns jsonb language plpgsql as $$ begin
      update fc_profiles set recommender_fc_id=p_inviter_fc_id where id=p_invitee_fc_id;
      if p_referral_code='FAILAPPLY' then raise exception 'synthetic_referral_failure'; end if;
      return '{"ok":true}'::jsonb; end $$;
    grant all on all tables in schema public to service_role;
  `);
  await db.exec(generations.slice(generations.indexOf('create or replace function public.advance_credential_session_version()'),
    generations.indexOf('-- The service verifies')));
  try {await db.exec(migration);await db.exec(hospitalMigration);await db.exec(recoveryMigration);await db.exec(smsDeliveryMigration);await db.exec(extendedSmsDeliveryMigration);
    if(seedSql) await db.exec(seedSql);await db.exec(enrollmentMigration);}
  catch(error) {throw new Error(error.message);}
  if(withWithdrawal) {
    // Extend this existing synthetic fixture, not a second database runner.
    // Exam registrations are absent here; the independent detach algorithm
    // retains its existing suite. Messenger cleanup runs the real functions.
    for(const column of ['resident_id_masked','resident_id_hash','address','address_detail','career_type',
      'recommender','recommender_code','admin_memo','dawichok_url_sent_by','allowance_reject_reason'])
      await db.exec(`alter table fc_profiles add column if not exists ${column} text`);
    await db.exec(`
      alter table fc_profiles add column recommender_code_id uuid;
      alter table fc_profiles add column phone_verified boolean default false;
      alter table fc_profiles add column phone_verified_at timestamptz;
      alter table fc_profiles add column phone_verification_sent_at timestamptz;
      alter table fc_profiles add column phone_verification_attempts integer default 0;
      alter table fc_profiles add column phone_verification_locked_until timestamptz;
      alter table exam_registrations add column resident_id text;
      alter table exam_registrations add column fc_id uuid;
      alter table notices add column created_by text;
      create table profiles(id uuid primary key,fc_id uuid references fc_profiles);
      create table admin_assisted_signup_consents(fc_id uuid references fc_profiles);
      create table board_comment_likes(resident_id text);
      create table board_post_reactions(resident_id text);
      create table board_post_views(resident_id text);
      create table board_comments(author_resident_id text);
      create table board_attachments(post_id uuid,created_by_resident_id text,storage_path text);
      create table notifications(fc_id uuid,resident_id text);
      create table device_tokens(resident_id text);
      create table web_push_subscriptions(resident_id text);
      create table user_presence(phone text);
      create table referral_events(inviter_phone text,invitee_phone text);
      create table referral_attributions(inviter_phone text,invitee_phone text);
      create table garamin_direct_conversations(id uuid,fc_id uuid);
      create table messenger_attachment_delivery_batches(id uuid,actor_role text,actor_id uuid,
        context_kind text,conversation_id uuid,conversation_ids uuid[],status text,expires_at timestamptz,
        deleted_at timestamptz,updated_at timestamptz);
      create table messages(sender_id text,receiver_id text,attachment_batch_id uuid,deleted_at timestamptz,
        deleted_by_actor_id uuid,content text,conversation_id uuid);
      create table group_chat_messages(id uuid,attachment_batch_id uuid,deleted_at timestamptz,content text);
      create table group_chat_notices(message_id uuid);
      create table messenger_attachment_objects(id uuid primary key,batch_id uuid,original_name text,byte_size bigint,
        sha256 text,bucket_id text,storage_path text,status text,reference_count integer,tombstoned_at timestamptz,deleted_at timestamptz);
      create table messenger_attachment_upload_intents(id uuid,batch_id uuid,original_name text,bucket_id text,
        object_path text,status text,updated_at timestamptz);
      create table messenger_attachment_deletion_audit(original_name text,byte_size bigint,sha256 text,reason_code text,deleted_at timestamptz);
      create schema auth;
      create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
      select set_config('request.jwt.claim.role','service_role',false);
      create function detach_exam_registration_identity_for_account_deletion(uuid) returns table(proof_path text)
        language sql as $$select null::text where false$$;
    `);
    await db.exec(accountDeletionMigration.slice(accountDeletionMigration.indexOf('create table if not exists public.account_deletion_cleanup_outbox'),
      accountDeletionMigration.indexOf('create or replace function public.delete_account_core_transaction_v1')));
    await db.exec(messengerMigration.slice(messengerMigration.indexOf('create table if not exists public.messenger_attachment_cleanup_outbox'),
      messengerMigration.indexOf('create unique index if not exists uq_messenger_attachment_cleanup_path_phase')));
    await db.exec(messengerMigration.slice(messengerMigration.indexOf('create or replace function public.claim_messenger_attachment_cleanup_v2'),
      messengerMigration.indexOf('create or replace function public.requeue_exhausted_messenger_attachment_cleanup_v2')));
    await db.exec(messengerMigration.slice(messengerMigration.indexOf('create or replace function public.reserve_messenger_attachment_upload_batch_v2'),
      messengerMigration.indexOf('create or replace function public.validate_messenger_attachment_intents_v2')));
    await db.exec(withdrawalMigration);
    await db.exec('grant all on all tables in schema public to service_role; grant usage on schema auth to service_role');
  }
}
