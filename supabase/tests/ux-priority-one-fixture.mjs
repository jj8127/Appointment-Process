import { readFile } from 'node:fs/promises';
export const migration = await readFile(new URL('../migrations/20261009052048_ux_priority_one_atomic_mutations.sql', import.meta.url), 'utf8');
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
