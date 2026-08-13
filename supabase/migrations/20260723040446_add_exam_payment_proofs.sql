-- Private proof storage. Mobile clients receive short-lived upload URLs only
-- after the signed app session has been verified by the Edge Function.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'exam-payment-proofs',
  'exam-payment-proofs',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "exam payment proofs service role" on storage.objects;
create policy "exam payment proofs service role"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'exam-payment-proofs')
  with check (bucket_id = 'exam-payment-proofs');

create table if not exists public.exam_payment_proof_uploads (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  fc_id uuid not null references public.fc_profiles (id) on delete cascade,
  storage_path text not null unique,
  original_file_name text not null,
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size bigint not null
    check (file_size > 0 and file_size <= 10485760),
  status text not null default 'pending'
    check (status in ('pending', 'attached', 'replaced', 'discarded')),
  registration_id uuid references public.exam_registrations (id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_payment_proof_uploads_status_shape_check check (
    (status = 'pending' and registration_id is null and consumed_at is null)
    or (status = 'attached' and registration_id is not null and consumed_at is not null)
    or status in ('replaced', 'discarded')
  ),
  constraint exam_payment_proof_uploads_fc_request_key unique (fc_id, request_id)
);

alter table public.exam_payment_proof_uploads enable row level security;
revoke all on table public.exam_payment_proof_uploads from public, anon, authenticated;
grant select, insert, update, delete on table public.exam_payment_proof_uploads to service_role;

create index if not exists idx_exam_payment_proof_uploads_pending_expiry
  on public.exam_payment_proof_uploads (expires_at)
  where status = 'pending';

create unique index if not exists idx_exam_payment_proof_uploads_current_registration
  on public.exam_payment_proof_uploads (registration_id)
  where status = 'attached';

drop trigger if exists trg_exam_payment_proof_uploads_updated_at
  on public.exam_payment_proof_uploads;
create trigger trg_exam_payment_proof_uploads_updated_at
before update on public.exam_payment_proof_uploads
for each row execute function public.set_updated_at();

alter table public.exam_registrations
  add column if not exists payment_proof_attached boolean not null default false;

alter table public.exam_registrations
  add column if not exists payment_proof_policy_version smallint not null default 0;

alter table public.exam_registrations
  drop constraint if exists exam_registrations_payment_proof_policy_check;

alter table public.exam_registrations
  add constraint exam_registrations_payment_proof_policy_check
  check (
    payment_proof_policy_version in (0, 1)
    and (payment_proof_policy_version = 0 or payment_proof_attached)
  );

create or replace function public.submit_exam_registration_with_payment_proof(
  p_fc_id uuid,
  p_resident_id text,
  p_round_id uuid,
  p_location_id uuid,
  p_is_third_exam boolean,
  p_fee_paid_date date,
  p_upload_id uuid default null
)
returns table (
  registration_id uuid,
  previous_proof_path text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registration public.exam_registrations%rowtype;
  v_upload public.exam_payment_proof_uploads%rowtype;
  v_previous_proof_path text;
begin
  if p_fc_id is null or nullif(trim(p_resident_id), '') is null then
    raise exception using errcode = '22023', message = 'invalid_exam_actor';
  end if;

  select *
    into v_registration
    from public.exam_registrations
   where round_id = p_round_id
     and resident_id = p_resident_id
   for update;

  if v_registration.id is not null and coalesce(v_registration.is_confirmed, false) then
    raise exception using errcode = '55000', message = 'confirmed_exam_registration';
  end if;

  if p_upload_id is null then
    if v_registration.id is null or not coalesce(v_registration.payment_proof_attached, false) then
      raise exception using errcode = '23514', message = 'payment_proof_required';
    end if;
  else
    select *
      into v_upload
      from public.exam_payment_proof_uploads
     where id = p_upload_id
       and fc_id = p_fc_id
     for update;

    if v_upload.id is null then
      raise exception using errcode = '22023', message = 'payment_proof_not_found';
    end if;

    if v_upload.status = 'pending' and v_upload.expires_at <= now() then
      raise exception using errcode = '55000', message = 'payment_proof_expired';
    end if;

    if v_upload.status = 'attached' then
      if v_registration.id is null or v_upload.registration_id <> v_registration.id then
        raise exception using errcode = '55000', message = 'payment_proof_already_used';
      end if;
    elsif v_upload.status <> 'pending' then
      raise exception using errcode = '55000', message = 'payment_proof_not_available';
    end if;
  end if;

  if v_registration.id is null then
    insert into public.exam_registrations (
      resident_id,
      fc_id,
      round_id,
      location_id,
      status,
      is_confirmed,
      is_third_exam,
      fee_paid_date,
      payment_proof_attached,
      payment_proof_policy_version
    )
    values (
      p_resident_id,
      p_fc_id,
      p_round_id,
      p_location_id,
      'applied',
      false,
      p_is_third_exam,
      p_fee_paid_date,
      p_upload_id is not null,
      1
    )
    returning * into v_registration;
  else
    update public.exam_registrations
       set fc_id = p_fc_id,
           location_id = p_location_id,
           status = 'applied',
           is_confirmed = false,
           is_third_exam = p_is_third_exam,
           fee_paid_date = p_fee_paid_date,
           payment_proof_attached =
             payment_proof_attached or p_upload_id is not null,
           payment_proof_policy_version = 1
     where id = v_registration.id
    returning * into v_registration;
  end if;

  if p_upload_id is not null and v_upload.status = 'pending' then
    select storage_path
      into v_previous_proof_path
      from public.exam_payment_proof_uploads
     where registration_id = v_registration.id
       and status = 'attached'
     for update;

    update public.exam_payment_proof_uploads
       set status = 'replaced'
     where registration_id = v_registration.id
       and status = 'attached';

    update public.exam_payment_proof_uploads
       set status = 'attached',
           registration_id = v_registration.id,
           consumed_at = now()
     where id = p_upload_id;
  end if;

  return query
  select v_registration.id, v_previous_proof_path;
end;
$$;

revoke all on function public.submit_exam_registration_with_payment_proof(
  uuid,
  text,
  uuid,
  uuid,
  boolean,
  date,
  uuid
) from public, anon, authenticated;

grant execute on function public.submit_exam_registration_with_payment_proof(
  uuid,
  text,
  uuid,
  uuid,
  boolean,
  date,
  uuid
) to service_role;
