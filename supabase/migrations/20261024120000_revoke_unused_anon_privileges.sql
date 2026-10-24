-- Stage 0 of the anon lockdown: remove every anon/authenticated privilege that no
-- client version uses, and close the anon delete/approve/overwrite paths.
-- The app signs in with its own phone+password sessions, so every client request
-- reaches PostgREST, Storage and Realtime as role anon. The remaining anon reads
-- are the ones live clients still make; later stages move them behind
-- session-checked Edge Functions before they are revoked.
-- Re-runnable: grants are reset from scratch and policies use drop ... if exists.

-- Fail fast instead of queueing API traffic behind the policy and trigger locks.
set local lock_timeout = '3s';

-- 1. Default deny for the API roles on every public table, view and sequence,
-- including the ones later migrations create as postgres.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- 2. Re-grant only what live clients use.
-- fc_profiles: the select columns of every app revision still installed.
-- Excluded: verification hashes, resident_id_hash, admin_memo, signup proof and
-- referral bookkeeping columns. INSERT/UPDATE stay table-level because installed
-- apps still send them; RLS ("fc_profiles insert/update") already rejects anon, and
-- apps up to 4.2.19 rely on the zero-row update ending without an error.
grant select (
  id, temp_id, name, affiliation, resident_id_masked, phone, recommender, email,
  address, address_detail, career_type, allowance_date, status, created_at,
  appointment_url, appointment_date, appointment_schedule_life, appointment_schedule_nonlife,
  appointment_date_life, appointment_date_nonlife, appointment_date_life_sub,
  appointment_date_nonlife_sub, is_tour_seen, identity_completed, carrier,
  allowance_reject_reason, appointment_reject_reason_life, appointment_reject_reason_nonlife,
  docs_deadline_at, signup_completed, life_commission_completed, nonlife_commission_completed,
  hanwha_commission_date_sub, hanwha_commission_date, hanwha_commission_reject_reason,
  hanwha_commission_pdf_path, hanwha_commission_pdf_name, allowance_prescreen_requested_at,
  recommender_fc_id, license_statuses, dawichok_url_sent_at, dawichok_url_sent_by
) on public.fc_profiles to anon;
grant insert, update on public.fc_profiles to anon;

-- fc_documents: the app reads its rows and upserts its own pending submission.
-- No client deletes rows directly; approval and removal go through service role.
grant select (id, fc_id, doc_type, storage_path, file_name, status, reviewer_note)
  on public.fc_documents to anon;
grant insert (fc_id, doc_type, storage_path, file_name, status, reviewer_note),
  update (fc_id, doc_type, storage_path, file_name, status, reviewer_note)
  on public.fc_documents to anon;

-- exam tables: the schedule is public; registrations expose only list columns.
grant select on public.exam_rounds, public.exam_locations to anon;
grant select (
  id, resident_id, round_id, location_id, exam_type, exam_month, status, is_confirmed,
  includes_primary_exam, is_third_exam, fee_paid_date, payment_proof_attached,
  rejection_reason, rejected_at, created_at
) on public.exam_registrations to anon;

-- group_chat_messages: the app (group-chat.tsx) and admin web (dashboard/group-chat)
-- still subscribe with a room_id filter, which Realtime checks against SELECT;
-- RLS "group_chat_messages service role" keeps every row hidden.
grant select on public.group_chat_messages to anon;

-- 3. anon may only submit its own pending document or the tombstone that apps up
-- to 4.2.17 write when a member removes a file. Approval, reviewer notes, other
-- FCs' paths and moving a row to another FC or document type stay service role.
create or replace function public.fc_documents_anon_write_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user <> 'anon' then
    return new;
  end if;
  if tg_op = 'UPDATE' and (new.fc_id is distinct from old.fc_id or new.doc_type is distinct from old.doc_type) then
    raise exception 'fc_documents_anon_write_guard: fc_id and doc_type are immutable' using errcode = '42501';
  end if;
  if new.status is distinct from 'pending' or new.reviewer_note is not null then
    raise exception 'fc_documents_anon_write_guard: only pending submissions' using errcode = '42501';
  end if;
  if new.storage_path = 'deleted' and new.file_name = 'deleted.pdf' then
    return new;
  end if;
  if new.storage_path is null or left(new.storage_path, length(new.fc_id::text) + 1) <> (new.fc_id::text || '/') then
    raise exception 'fc_documents_anon_write_guard: storage path must be under the member folder' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.fc_documents_anon_write_guard() from public, anon, authenticated;

drop trigger if exists fc_documents_anon_write_guard on public.fc_documents;
create trigger fc_documents_anon_write_guard
  before insert or update on public.fc_documents
  for each row execute function public.fc_documents_anon_write_guard();

-- 4. Policies that only granted anon/authenticated destructive access.
drop policy if exists "fc_documents delete" on public.fc_documents;
drop policy if exists "notices delete" on public.notices;
drop policy if exists "notifications delete" on public.notifications;
drop policy if exists "exam_registrations anon insert" on public.exam_registrations;
drop policy if exists "exam_registrations anon update" on public.exam_registrations;
drop policy if exists "exam_registrations anon delete" on public.exam_registrations;

-- 5. generate_temp_id is SECURITY DEFINER and has no caller outside service role.
revoke all on function public.generate_temp_id() from public, anon, authenticated;
grant execute on function public.generate_temp_id() to service_role;

-- 6. Storage. Notice attachments are uploaded (no upsert) and read through public
-- URLs; nobody may list-and-replace or delete them through the API any more.
-- Both uploaders name files "<images|files>/<epoch ms>_..." (app) or
-- "<epoch ms>_..." (admin web), so other names are not accepted.
drop policy if exists "Allow Absolutely All Notice Attachments" on storage.objects;
drop policy if exists "notice-attachments insert" on storage.objects;
create policy "notice-attachments insert"
  on storage.objects for insert
  with check (bucket_id = 'notice-attachments' and name ~ '^((images|files)/)?[0-9]{13}_');
update storage.buckets set file_size_limit = 52428800
  where id = 'notice-attachments' and file_size_limit is null;
drop policy if exists "notice-attachments read" on storage.objects;
create policy "notice-attachments read"
  on storage.objects for select
  using (bucket_id = 'notice-attachments');

-- chat-uploads is written only by 3.0.0 apps, whose chat already fails on
-- public.messages; existing objects stay readable through their public URLs.
drop policy if exists "chat-uploads insert" on storage.objects;
drop policy if exists "chat-uploads select" on storage.objects;
drop policy if exists "chat-uploads write" on storage.objects;
drop policy if exists "chat-uploads delete" on storage.objects;

notify pgrst, 'reload schema';
