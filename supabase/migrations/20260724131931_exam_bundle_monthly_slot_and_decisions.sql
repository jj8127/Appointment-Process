-- One durable exam-registration bundle per FC and calendar exam month.
-- This migration deliberately fails closed when legacy active rows cannot be
-- mapped without guessing. It never deletes or auto-rejects customer history.

alter table public.exam_registrations
  add column if not exists exam_month date;

alter table public.exam_registrations
  add column if not exists includes_primary_exam boolean;

alter table public.exam_registrations
  add column if not exists rejection_reason text;

alter table public.exam_registrations
  add column if not exists rejected_at timestamptz;

alter table public.exam_registrations
  add column if not exists rejected_by_admin_id uuid
    references public.admin_accounts (id) on delete set null;

alter table public.exam_registrations
  add column if not exists rejected_by_staff_type text;

update public.exam_registrations
   set includes_primary_exam = true
 where includes_primary_exam is null;

update public.exam_registrations registration
   set exam_month = date_trunc('month', round_row.exam_date)::date
  from public.exam_rounds round_row
 where round_row.id = registration.round_id
   and round_row.exam_date is not null
   and registration.exam_month is null;

do $preflight$
begin
  if exists (
    select 1
      from public.exam_registrations registration
     where registration.status in ('applied', 'confirmed', 'completed', 'no_show')
       and registration.exam_month is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'exam_bundle_preflight_missing_active_exam_date';
  end if;

  if exists (
    select 1
      from public.exam_registrations registration
     where registration.status in ('applied', 'confirmed', 'completed', 'no_show')
       and (
         registration.fc_id is null
         or not exists (
           select 1
             from public.fc_profiles profile
            where profile.id = registration.fc_id
              and nullif(
                regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g'),
                ''
              ) = nullif(
                regexp_replace(coalesce(registration.resident_id, ''), '[^0-9]', '', 'g'),
                ''
              )
         )
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'exam_bundle_preflight_active_fc_ownership_mismatch';
  end if;

  if exists (
    select 1
      from public.exam_registrations registration
     where (
       registration.status in ('confirmed', 'completed', 'no_show')
       and not coalesce(registration.is_confirmed, false)
     ) or (
       registration.status in ('applied', 'rejected', 'cancelled_by_fc', 'cancelled_by_admin')
       and coalesce(registration.is_confirmed, false)
     )
  ) then
    raise exception using
      errcode = '23514',
      message = 'exam_bundle_preflight_confirmation_status_drift';
  end if;
end
$preflight$;

do $collision_preflight$
begin
  if exists (
    select 1
      from public.exam_registrations registration
     where registration.status in ('applied', 'confirmed', 'completed', 'no_show')
     group by registration.fc_id, registration.exam_month
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'exam_bundle_preflight_active_month_collision';
  end if;
end
$collision_preflight$;

alter table public.exam_registrations
  alter column includes_primary_exam set default true;

alter table public.exam_registrations
  alter column includes_primary_exam set not null;

alter table public.exam_registrations
  alter column is_third_exam set default false;

update public.exam_registrations
   set is_third_exam = false
 where is_third_exam is null;

alter table public.exam_registrations
  alter column is_third_exam set not null;

update public.exam_registrations
   set is_confirmed = false
 where is_confirmed is null;

alter table public.exam_registrations
  alter column is_confirmed set default false;

alter table public.exam_registrations
  alter column is_confirmed set not null;

alter table public.exam_registrations
  drop constraint if exists exam_registrations_status_check;

alter table public.exam_registrations
  add constraint exam_registrations_status_check
  check (
    status in (
      'applied',
      'confirmed',
      'completed',
      'no_show',
      'rejected',
      'cancelled_by_fc',
      'cancelled_by_admin'
    )
  );

alter table public.exam_registrations
  drop constraint if exists exam_registrations_confirmation_status_check;

alter table public.exam_registrations
  add constraint exam_registrations_confirmation_status_check
  check (
    is_confirmed = (
      status in ('confirmed', 'completed', 'no_show')
    )
  );

alter table public.exam_registrations
  drop constraint if exists exam_registrations_active_month_shape_check;

alter table public.exam_registrations
  add constraint exam_registrations_active_month_shape_check
  check (
    status not in ('applied', 'confirmed', 'completed', 'no_show')
    or (
      exam_month is not null
      and exam_month = date_trunc('month', exam_month)::date
      and (
        fc_id is not null
        or resident_id like 'deleted-exam:%'
      )
    )
  );

alter table public.exam_registrations
  drop constraint if exists exam_registrations_subject_selection_check;

alter table public.exam_registrations
  add constraint exam_registrations_subject_selection_check
  check (includes_primary_exam or is_third_exam);

alter table public.exam_registrations
  drop constraint if exists exam_registrations_rejection_shape_check;

alter table public.exam_registrations
  add constraint exam_registrations_rejection_shape_check
  check (
    (
      status = 'rejected'
      and rejection_reason is not null
      and char_length(btrim(rejection_reason)) between 1 and 1000
      and rejected_at is not null
      and rejected_by_staff_type in ('admin', 'developer')
    )
    or (
      status <> 'rejected'
      and rejection_reason is null
      and rejected_at is null
      and rejected_by_admin_id is null
      and rejected_by_staff_type is null
    )
  );

alter table public.exam_registrations
  drop constraint if exists exam_registrations_payment_proof_policy_check;

alter table public.exam_registrations
  add constraint exam_registrations_payment_proof_policy_check
  check (
    payment_proof_policy_version in (0, 1)
    and (
      payment_proof_policy_version = 0
      or payment_proof_attached
      or status in ('cancelled_by_fc', 'cancelled_by_admin')
      or resident_id like 'deleted-exam:%'
    )
  );

drop index if exists public.idx_exam_registrations_round_resident;

create unique index if not exists idx_exam_registrations_active_fc_exam_month
  on public.exam_registrations (fc_id, exam_month)
  where status in ('applied', 'confirmed', 'completed', 'no_show');

create index if not exists idx_exam_registrations_resident_history
  on public.exam_registrations (resident_id, created_at desc, id desc);

create table if not exists public.exam_registration_decision_events (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null
    references public.exam_registrations (id) on delete restrict,
  action text not null
    check (
      action in (
        'submitted',
        'updated',
        'confirmed',
        'unconfirmed',
        'rejected',
        'cancelled_by_fc',
        'cancelled_by_admin',
        'identity_detached'
      )
    ),
  from_status text,
  to_status text not null,
  reason text,
  actor_type text not null
    check (actor_type in ('fc', 'admin', 'developer', 'service')),
  actor_admin_id_snapshot uuid,
  actor_fc_id_snapshot uuid,
  created_at timestamptz not null default now(),
  constraint exam_registration_decision_events_reason_check
    check (
      (action = 'rejected' and char_length(btrim(coalesce(reason, ''))) between 1 and 1000)
      or (action <> 'rejected' and reason is null)
    )
);

alter table public.exam_registration_decision_events enable row level security;
revoke all on table public.exam_registration_decision_events
  from public, anon, authenticated, service_role;
revoke update, delete, truncate on table public.exam_registration_decision_events
  from service_role;
grant select, insert on table public.exam_registration_decision_events
  to service_role;

create or replace function public.reject_exam_decision_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'exam_decision_events_are_append_only';
end;
$$;

drop trigger if exists trg_reject_exam_decision_event_mutation
  on public.exam_registration_decision_events;
create trigger trg_reject_exam_decision_event_mutation
before update or delete or truncate on public.exam_registration_decision_events
for each statement execute function public.reject_exam_decision_event_mutation();

create or replace function public.prevent_exam_history_drift()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'exam_rounds' then
    if tg_op = 'DELETE' and exists (
      select 1
        from public.exam_registrations registration
       where registration.round_id = old.id
    ) then
      raise exception using errcode = '55000', message = 'exam_round_has_registrations';
    end if;

    if tg_op = 'UPDATE'
       and (
         new.exam_date is distinct from old.exam_date
         or new.exam_type is distinct from old.exam_type
       )
       and exists (
         select 1
           from public.exam_registrations registration
          where registration.round_id = old.id
       ) then
      raise exception using errcode = '55000', message = 'exam_round_history_locked';
    end if;
  elsif tg_table_name = 'exam_locations' then
    if tg_op = 'DELETE' and exists (
      select 1
        from public.exam_registrations registration
       where registration.location_id = old.id
    ) then
      raise exception using errcode = '55000', message = 'exam_location_has_registrations';
    end if;

    if tg_op = 'UPDATE'
       and new.round_id is distinct from old.round_id
       and exists (
         select 1
           from public.exam_registrations registration
          where registration.location_id = old.id
       ) then
      raise exception using errcode = '55000', message = 'exam_location_history_locked';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_prevent_exam_round_history_drift
  on public.exam_rounds;
create trigger trg_prevent_exam_round_history_drift
before update or delete on public.exam_rounds
for each row execute function public.prevent_exam_history_drift();

drop trigger if exists trg_prevent_exam_location_history_drift
  on public.exam_locations;
create trigger trg_prevent_exam_location_history_drift
before update or delete on public.exam_locations
for each row execute function public.prevent_exam_history_drift();

alter table public.exam_registrations
  drop constraint if exists exam_registrations_round_id_fkey;
alter table public.exam_registrations
  add constraint exam_registrations_round_id_fkey
  foreign key (round_id) references public.exam_rounds (id) on delete restrict;

alter table public.exam_registrations
  drop constraint if exists exam_registrations_location_id_fkey;
alter table public.exam_registrations
  drop constraint if exists exam_registrations_location_round_fkey;
alter table public.exam_registrations
  add constraint exam_registrations_location_round_fkey
  foreign key (location_id, round_id)
  references public.exam_locations (id, round_id)
  on delete restrict;

drop policy if exists "exam_registrations insert" on public.exam_registrations;
drop policy if exists "exam_registrations anon insert" on public.exam_registrations;
drop policy if exists "exam_registrations update" on public.exam_registrations;
drop policy if exists "exam_registrations anon update" on public.exam_registrations;
drop policy if exists "exam_registrations delete" on public.exam_registrations;
drop policy if exists "exam_registrations anon delete" on public.exam_registrations;
revoke insert, update, delete on table public.exam_registrations
  from anon, authenticated;

drop policy if exists "exam_rounds insert" on public.exam_rounds;
drop policy if exists "exam_rounds anon insert" on public.exam_rounds;
drop policy if exists "exam_rounds update" on public.exam_rounds;
drop policy if exists "exam_rounds delete" on public.exam_rounds;
revoke insert, update, delete on table public.exam_rounds
  from anon, authenticated;

drop policy if exists "exam_locations insert" on public.exam_locations;
drop policy if exists "exam_locations anon insert" on public.exam_locations;
drop policy if exists "exam_locations update" on public.exam_locations;
drop policy if exists "exam_locations delete" on public.exam_locations;
revoke insert, update, delete on table public.exam_locations
  from anon, authenticated;

create or replace function public.submit_exam_registration_with_payment_proof_v2(
  p_fc_id uuid,
  p_resident_id text,
  p_round_id uuid,
  p_location_id uuid,
  p_includes_primary_exam boolean,
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
  v_round public.exam_rounds%rowtype;
  v_upload public.exam_payment_proof_uploads%rowtype;
  v_exam_month date;
  v_previous_proof_path text;
  v_action text;
begin
  if p_fc_id is null or nullif(btrim(p_resident_id), '') is null then
    raise exception using errcode = '22023', message = 'invalid_exam_actor';
  end if;
  if not coalesce(p_includes_primary_exam, false)
     and not coalesce(p_is_third_exam, false) then
    raise exception using errcode = '23514', message = 'exam_subject_required';
  end if;
  if p_fee_paid_date is null or p_fee_paid_date > current_date then
    raise exception using errcode = '22023', message = 'invalid_fee_paid_date';
  end if;

  select round_row.*
    into v_round
    from public.exam_rounds round_row
   where round_row.id = p_round_id
   for share;

  if v_round.id is null or v_round.exam_date is null then
    raise exception using errcode = '22023', message = 'invalid_exam_round';
  end if;
  if v_round.registration_deadline < current_date then
    raise exception using errcode = '55000', message = 'exam_round_closed';
  end if;
  if not exists (
    select 1
      from public.exam_locations location
     where location.id = p_location_id
       and location.round_id = p_round_id
  ) then
    raise exception using errcode = '23503', message = 'invalid_exam_location';
  end if;

  v_exam_month := date_trunc('month', v_round.exam_date)::date;
  perform pg_advisory_xact_lock(
    hashtextextended(p_fc_id::text || ':' || v_exam_month::text, 0)
  );

  select registration.*
    into v_registration
    from public.exam_registrations registration
   where registration.fc_id = p_fc_id
     and registration.exam_month = v_exam_month
     and registration.status in ('applied', 'confirmed', 'completed', 'no_show')
   order by registration.created_at, registration.id
   limit 1
   for update;

  if v_registration.id is not null
     and (
       v_registration.round_id <> p_round_id
       or v_registration.status <> 'applied'
       or coalesce(v_registration.is_confirmed, false)
     ) then
    raise exception using errcode = '23505', message = 'active_exam_month_already_registered';
  end if;

  if p_upload_id is null then
    if v_registration.id is null
       or not coalesce(v_registration.payment_proof_attached, false) then
      raise exception using errcode = '23514', message = 'payment_proof_required';
    end if;
  else
    select upload.*
      into v_upload
      from public.exam_payment_proof_uploads upload
     where upload.id = p_upload_id
       and upload.fc_id = p_fc_id
     for update;

    if v_upload.id is null then
      raise exception using errcode = '22023', message = 'payment_proof_not_found';
    end if;
    if v_upload.status = 'pending' and v_upload.expires_at <= now() then
      raise exception using errcode = '55000', message = 'payment_proof_expired';
    end if;
    if v_upload.status = 'attached' then
      if v_registration.id is null
         or v_upload.registration_id <> v_registration.id then
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
      exam_month,
      status,
      is_confirmed,
      includes_primary_exam,
      is_third_exam,
      fee_paid_date,
      payment_proof_attached,
      payment_proof_policy_version
    ) values (
      btrim(p_resident_id),
      p_fc_id,
      p_round_id,
      p_location_id,
      v_exam_month,
      'applied',
      false,
      p_includes_primary_exam,
      p_is_third_exam,
      p_fee_paid_date,
      p_upload_id is not null,
      1
    )
    returning * into v_registration;
    v_action := 'submitted';
  else
    update public.exam_registrations
       set resident_id = btrim(p_resident_id),
           location_id = p_location_id,
           includes_primary_exam = p_includes_primary_exam,
           is_third_exam = p_is_third_exam,
           fee_paid_date = p_fee_paid_date,
           payment_proof_attached =
             payment_proof_attached or p_upload_id is not null,
           payment_proof_policy_version = 1
     where id = v_registration.id
    returning * into v_registration;
    v_action := 'updated';
  end if;

  if p_upload_id is not null and v_upload.status = 'pending' then
    select proof.storage_path
      into v_previous_proof_path
      from public.exam_payment_proof_uploads proof
     where proof.registration_id = v_registration.id
       and proof.status = 'attached'
     for update;

    update public.exam_payment_proof_uploads proof
       set status = 'replaced'
     where proof.registration_id = v_registration.id
       and proof.status = 'attached';

    update public.exam_payment_proof_uploads proof
       set status = 'attached',
           registration_id = v_registration.id,
           consumed_at = now()
     where proof.id = p_upload_id;
  end if;

  insert into public.exam_registration_decision_events (
    registration_id,
    action,
    from_status,
    to_status,
    actor_type,
    actor_fc_id_snapshot
  ) values (
    v_registration.id,
    v_action,
    case when v_action = 'updated' then 'applied' else null end,
    'applied',
    'fc',
    p_fc_id
  );

  return query
  select v_registration.id, v_previous_proof_path;
end;
$$;

revoke all on function public.submit_exam_registration_with_payment_proof_v2(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid
) from public, anon, authenticated;
grant execute on function public.submit_exam_registration_with_payment_proof_v2(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid
) to service_role;

-- Compatibility entry point: old clients always select the round's primary
-- subject and can no longer bypass the calendar-month boundary.
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
language sql
security invoker
set search_path = public, pg_temp
as $$
  select *
    from public.submit_exam_registration_with_payment_proof_v2(
      p_fc_id,
      p_resident_id,
      p_round_id,
      p_location_id,
      true,
      coalesce(p_is_third_exam, false),
      p_fee_paid_date,
      p_upload_id
    );
$$;

revoke all on function public.submit_exam_registration_with_payment_proof(
  uuid, text, uuid, uuid, boolean, date, uuid
) from public, anon, authenticated;
grant execute on function public.submit_exam_registration_with_payment_proof(
  uuid, text, uuid, uuid, boolean, date, uuid
) to service_role;

create or replace function public.transition_exam_registration(
  p_registration_id uuid,
  p_action text,
  p_actor_type text,
  p_actor_admin_id uuid default null,
  p_actor_fc_id uuid default null,
  p_reason text default null
)
returns table (
  registration_id uuid,
  status text,
  proof_path text,
  target_resident_id text,
  exam_type text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registration public.exam_registrations%rowtype;
  v_admin public.admin_accounts%rowtype;
  v_exam_type text;
  v_from_status text;
  v_to_status text;
  v_reason text;
  v_proof_path text;
  v_target_url text;
  v_title text;
  v_body text;
begin
  select registration, round_row.exam_type
    into v_registration, v_exam_type
    from public.exam_registrations registration
    join public.exam_rounds round_row on round_row.id = registration.round_id
   where registration.id = p_registration_id
   for update of registration;

  if v_registration.id is null then
    raise exception using errcode = 'P0002', message = 'exam_registration_not_found';
  end if;

  if v_registration.status in ('completed', 'no_show') then
    raise exception using errcode = '55000', message = 'terminal_exam_registration';
  end if;

  if p_action = 'cancel_by_fc' then
    if p_actor_type <> 'fc'
       or p_actor_fc_id is null
       or p_actor_fc_id <> v_registration.fc_id then
      raise exception using errcode = '42501', message = 'exam_transition_forbidden';
    end if;
  else
    if p_actor_type not in ('admin', 'developer') or p_actor_admin_id is null then
      raise exception using errcode = '42501', message = 'exam_transition_forbidden';
    end if;
    select admin_row.*
      into v_admin
      from public.admin_accounts admin_row
     where admin_row.id = p_actor_admin_id
       and admin_row.active = true
       and (
         (p_actor_type = 'developer' and admin_row.staff_type = 'developer')
         or (p_actor_type = 'admin' and coalesce(admin_row.staff_type, 'admin') = 'admin')
       )
     for share;
    if v_admin.id is null then
      raise exception using errcode = '42501', message = 'exam_transition_forbidden';
    end if;
  end if;

  v_from_status := v_registration.status;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  case p_action
    when 'confirm' then
      if v_from_status <> 'applied' then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'confirmed';
    when 'unconfirm' then
      if v_from_status <> 'confirmed' then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'applied';
    when 'reject' then
      if v_from_status not in ('applied', 'confirmed') then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      if v_reason is null or char_length(v_reason) > 1000 then
        raise exception using errcode = '22023', message = 'invalid_rejection_reason';
      end if;
      v_to_status := 'rejected';
    when 'cancel_by_fc' then
      if v_from_status <> 'applied' then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'cancelled_by_fc';
    when 'cancel_by_admin' then
      if v_from_status not in ('applied', 'confirmed') then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'cancelled_by_admin';
    else
      raise exception using errcode = '22023', message = 'invalid_exam_transition_action';
  end case;

  if v_to_status in ('cancelled_by_fc', 'cancelled_by_admin') then
    select proof.storage_path
      into v_proof_path
      from public.exam_payment_proof_uploads proof
     where proof.registration_id = v_registration.id
       and proof.status = 'attached'
     for update;

    update public.exam_payment_proof_uploads proof
       set status = 'discarded'
     where proof.registration_id = v_registration.id
       and proof.status = 'attached';
  end if;

  update public.exam_registrations registration
     set status = v_to_status,
         is_confirmed = v_to_status = 'confirmed',
         payment_proof_attached = case
           when v_to_status in ('cancelled_by_fc', 'cancelled_by_admin') then false
           else registration.payment_proof_attached
         end,
         rejection_reason = case when v_to_status = 'rejected' then v_reason else null end,
         rejected_at = case when v_to_status = 'rejected' then now() else null end,
         rejected_by_admin_id = case
           when v_to_status = 'rejected' then p_actor_admin_id
           else null
         end,
         rejected_by_staff_type = case
           when v_to_status = 'rejected' then p_actor_type
           else null
         end
   where registration.id = v_registration.id;

  insert into public.exam_registration_decision_events (
    registration_id,
    action,
    from_status,
    to_status,
    reason,
    actor_type,
    actor_admin_id_snapshot,
    actor_fc_id_snapshot
  ) values (
    v_registration.id,
    case p_action
      when 'confirm' then 'confirmed'
      when 'unconfirm' then 'unconfirmed'
      when 'reject' then 'rejected'
      when 'cancel_by_fc' then 'cancelled_by_fc'
      when 'cancel_by_admin' then 'cancelled_by_admin'
    end,
    v_from_status,
    v_to_status,
    case when p_action = 'reject' then v_reason else null end,
    p_actor_type,
    p_actor_admin_id,
    p_actor_fc_id
  );

  if p_action <> 'cancel_by_fc' then
    v_target_url := case
      when v_exam_type = 'nonlife' then '/exam-apply2'
      else '/exam-apply'
    end;
    v_title := case p_action
      when 'confirm' then '시험 접수가 승인되었습니다.'
      when 'unconfirm' then '시험 접수 승인이 취소되었습니다.'
      when 'reject' then '시험 접수가 반려되었습니다.'
      else '시험 접수가 취소되었습니다.'
    end;
    v_body := case
      when p_action = 'reject' then v_title || ' 사유: ' || v_reason
      else v_title
    end;

    insert into public.notifications (
      fc_id,
      resident_id,
      recipient_role,
      title,
      body,
      category,
      target_url
    ) values (
      v_registration.fc_id,
      v_registration.resident_id,
      'fc',
      v_title,
      v_body,
      'exam_apply',
      v_target_url
    );
  end if;

  return query
  select
    v_registration.id,
    v_to_status,
    v_proof_path,
    v_registration.resident_id,
    v_exam_type;
end;
$$;

revoke all on function public.transition_exam_registration(
  uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.transition_exam_registration(
  uuid, text, text, uuid, uuid, text
) to service_role;

create or replace function public.detach_exam_registration_identity_for_account_deletion(
  p_fc_id uuid
)
returns table (proof_path text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registration public.exam_registrations%rowtype;
  v_to_status text;
begin
  if p_fc_id is null then
    raise exception using errcode = '22023', message = 'fc_id_required';
  end if;

  return query
  update public.exam_payment_proof_uploads upload
     set status = 'discarded'
   where upload.fc_id = p_fc_id
     and upload.status in ('pending', 'attached')
  returning upload.storage_path;

  for v_registration in
    select registration.*
     from public.exam_registrations registration
     where registration.fc_id = p_fc_id
     order by registration.created_at, registration.id
     for update
  loop
    v_to_status := case
      when v_registration.status in ('applied', 'confirmed') then 'cancelled_by_fc'
      else v_registration.status
    end;

    if v_to_status <> v_registration.status then
      insert into public.exam_registration_decision_events (
        registration_id,
        action,
        from_status,
        to_status,
        reason,
        actor_type
      ) values (
        v_registration.id,
        'cancelled_by_fc',
        v_registration.status,
        v_to_status,
        null,
        'service'
      );
    end if;

    update public.exam_registrations registration
       set status = v_to_status,
           is_confirmed = v_to_status in ('confirmed', 'completed', 'no_show'),
           payment_proof_attached = false,
           fc_id = null,
           resident_id = 'deleted-exam:' || registration.id::text,
           rejection_reason = case
             when v_to_status = 'rejected' then registration.rejection_reason
             else null
           end,
           rejected_at = case
             when v_to_status = 'rejected' then registration.rejected_at
             else null
           end,
           rejected_by_admin_id = case
             when v_to_status = 'rejected' then registration.rejected_by_admin_id
             else null
           end,
           rejected_by_staff_type = case
             when v_to_status = 'rejected' then registration.rejected_by_staff_type
             else null
           end
     where registration.id = v_registration.id;

    insert into public.exam_registration_decision_events (
      registration_id,
      action,
      from_status,
      to_status,
      reason,
      actor_type
    ) values (
      v_registration.id,
      'identity_detached',
      v_to_status,
      v_to_status,
      null,
      'service'
    );
  end loop;
end;
$$;

revoke all on function public.detach_exam_registration_identity_for_account_deletion(
  uuid
) from public, anon, authenticated;
grant execute on function public.detach_exam_registration_identity_for_account_deletion(
  uuid
) to service_role;

create table if not exists public.account_deletion_cleanup_outbox (
  id uuid primary key default gen_random_uuid(),
  cleanup_payload jsonb not null
    check (jsonb_typeof(cleanup_payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'exhausted')),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 10),
  last_error_code text
    check (
      last_error_code is null
      or (
        char_length(last_error_code) between 1 and 64
        and last_error_code ~ '^[a-z0-9_]+$'
      )
    ),
  next_attempt_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.account_deletion_cleanup_outbox enable row level security;
revoke all on table public.account_deletion_cleanup_outbox
  from public, anon, authenticated, service_role;
grant select, insert on table public.account_deletion_cleanup_outbox
  to service_role;

create index if not exists idx_account_deletion_cleanup_outbox_pending
  on public.account_deletion_cleanup_outbox (next_attempt_at, created_at)
  where status = 'pending' and attempt_count < 10;

create or replace function public.record_account_deletion_cleanup_attempt_v1(
  p_outbox_id uuid,
  p_succeeded boolean,
  p_error_code text default null
)
returns table (
  status text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_error_code text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'cleanup_outbox_forbidden';
  end if;
  if p_outbox_id is null then
    raise exception using errcode = '22023', message = 'cleanup_outbox_id_required';
  end if;

  v_error_code := case
    when coalesce(p_succeeded, false) then null
    else nullif(
      left(
        regexp_replace(lower(btrim(coalesce(p_error_code, ''))), '[^a-z0-9_]', '_', 'g'),
        64
      ),
      ''
    )
  end;
  if not coalesce(p_succeeded, false) and v_error_code is null then
    v_error_code := 'post_commit_cleanup_failed';
  end if;

  return query
  update public.account_deletion_cleanup_outbox outbox
     set attempt_count = least(outbox.attempt_count + 1, 10),
         status = case
           when coalesce(p_succeeded, false) then 'completed'
           when outbox.attempt_count + 1 >= 10 then 'exhausted'
           else 'pending'
         end,
         last_error_code = v_error_code,
         next_attempt_at = case
           when coalesce(p_succeeded, false) then outbox.next_attempt_at
           else now() + (
             least(3600, 30 * power(2, least(outbox.attempt_count, 9)))::text
             || ' seconds'
           )::interval
         end,
         completed_at = case
           when coalesce(p_succeeded, false) then now()
           else null
         end,
         updated_at = now()
   where outbox.id = p_outbox_id
     and outbox.status in ('pending', 'exhausted')
  returning outbox.status, outbox.attempt_count;

  if not found then
    raise exception using errcode = 'P0002', message = 'cleanup_outbox_not_pending';
  end if;
end;
$$;

revoke all on function public.record_account_deletion_cleanup_attempt_v1(
  uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.record_account_deletion_cleanup_attempt_v1(
  uuid, boolean, text
) to service_role;

create or replace function public.list_account_deletion_cleanup_pending_v1(
  p_limit integer default 10
)
returns table (
  outbox_id uuid,
  cleanup_payload jsonb,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'cleanup_outbox_forbidden';
  end if;

  return query
  select
    outbox.id,
    outbox.cleanup_payload,
    outbox.attempt_count
  from public.account_deletion_cleanup_outbox outbox
  where outbox.status = 'pending'
    and outbox.attempt_count < 10
    and outbox.next_attempt_at <= now()
  order by outbox.next_attempt_at, outbox.created_at
  limit least(greatest(coalesce(p_limit, 10), 1), 25);
end;
$$;

revoke all on function public.list_account_deletion_cleanup_pending_v1(
  integer
) from public, anon, authenticated;
grant execute on function public.list_account_deletion_cleanup_pending_v1(
  integer
) to service_role;

create or replace function public.delete_account_core_transaction_v1(
  p_target_role text,
  p_target_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_phone text;
  v_phone_digits text;
  v_fc_ids uuid[] := array[]::uuid[];
  v_fc_id uuid;
  v_proof_paths text[] := array[]::text[];
  v_new_proof_paths text[] := array[]::text[];
  v_document_paths text[] := array[]::text[];
  v_board_paths text[] := array[]::text[];
  v_chat_file_urls text[] := array[]::text[];
  v_auth_user_ids uuid[] := array[]::uuid[];
  v_post_ids uuid[] := array[]::uuid[];
  v_cleanup_outbox_id uuid;
  v_deleted_count integer := 0;
begin
  if p_target_id is null or p_target_role not in ('fc', 'admin', 'manager') then
    raise exception using errcode = '22023', message = 'invalid_account_delete_target';
  end if;

  if p_target_role = 'fc' then
    select profile.phone
      into v_phone
      from public.fc_profiles profile
     where profile.id = p_target_id
       and not profile.is_manager_referral_shadow
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;
    v_fc_ids := array[p_target_id];
  elsif p_target_role = 'admin' then
    select account.phone
      into v_phone
      from public.admin_accounts account
     where account.id = p_target_id
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;
  else
    select account.phone
      into v_phone
      from public.manager_accounts account
     where account.id = p_target_id
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;

    select coalesce(array_agg(profile.id order by profile.id), array[]::uuid[])
      into v_fc_ids
      from public.fc_profiles profile
     where profile.is_manager_referral_shadow
       and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g')
           = regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g');
  end if;

  v_phone_digits := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
  if v_phone_digits is null then
    raise exception using errcode = '23514', message = 'account_delete_phone_missing';
  end if;

  if cardinality(v_fc_ids) > 0 then
    perform 1
      from public.fc_profiles profile
     where profile.id = any(v_fc_ids)
     for update;

    if exists (
      select 1
        from public.exam_registrations registration
       where registration.resident_id not like 'deleted-exam:%'
         and (
           (
             registration.fc_id = any(v_fc_ids)
             and nullif(
               regexp_replace(coalesce(registration.resident_id, ''), '[^0-9]', '', 'g'),
               ''
             ) is distinct from v_phone_digits
           )
           or (
             nullif(
               regexp_replace(coalesce(registration.resident_id, ''), '[^0-9]', '', 'g'),
               ''
             ) = v_phone_digits
             and (
               registration.fc_id is null
               or not (registration.fc_id = any(v_fc_ids))
             )
           )
         )
    ) then
      raise exception using
        errcode = '23514',
        message = 'account_delete_exam_ownership_mismatch';
    end if;

    select coalesce(array_agg(document.storage_path), array[]::text[])
      into v_document_paths
      from public.fc_documents document
     where document.fc_id = any(v_fc_ids)
       and document.storage_path is not null
       and document.storage_path <> 'deleted';

    select coalesce(array_agg(profile.id), array[]::uuid[])
      into v_auth_user_ids
      from public.profiles profile
     where profile.fc_id = any(v_fc_ids);

    foreach v_fc_id in array v_fc_ids
    loop
      select coalesce(array_agg(detached.proof_path), array[]::text[])
        into v_new_proof_paths
        from public.detach_exam_registration_identity_for_account_deletion(v_fc_id) detached;
      v_proof_paths := v_proof_paths || v_new_proof_paths;
    end loop;
  end if;

  select coalesce(array_agg(post.id), array[]::uuid[])
    into v_post_ids
    from public.board_posts post
   where regexp_replace(coalesce(post.author_resident_id, ''), '[^0-9]', '', 'g')
         = v_phone_digits;

  select coalesce(array_agg(distinct attachment.storage_path), array[]::text[])
    into v_board_paths
    from public.board_attachments attachment
   where regexp_replace(coalesce(attachment.created_by_resident_id, ''), '[^0-9]', '', 'g')
         = v_phone_digits
      or attachment.post_id = any(v_post_ids);

  if to_regclass('public.messages') is not null then
    execute $dynamic$
      select coalesce(array_agg(file_url), array[]::text[])
        from public.messages
       where message_type in ('image', 'file')
         and regexp_replace(coalesce(sender_id, ''), '[^0-9]', '', 'g') = $1
    $dynamic$
    into v_chat_file_urls
    using v_phone_digits;
  end if;

  delete from public.board_comment_likes
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_post_reactions
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_post_views
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_comments
   where regexp_replace(coalesce(author_resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_attachments
   where regexp_replace(coalesce(created_by_resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_posts where id = any(v_post_ids);

  if to_regclass('public.messages') is not null then
    execute $dynamic$
      delete from public.messages
       where regexp_replace(coalesce(sender_id, ''), '[^0-9]', '', 'g') = $1
          or regexp_replace(coalesce(receiver_id, ''), '[^0-9]', '', 'g') = $1
    $dynamic$
    using v_phone_digits;
  end if;

  delete from public.notifications
   where (cardinality(v_fc_ids) > 0 and fc_id = any(v_fc_ids))
      or regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.device_tokens
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.web_push_subscriptions
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.user_presence
   where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.notices
   where regexp_replace(coalesce(created_by, ''), '[^0-9]', '', 'g') = v_phone_digits;

  delete from public.referral_events
   where regexp_replace(coalesce(inviter_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      or regexp_replace(coalesce(invitee_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.referral_attributions
   where regexp_replace(coalesce(inviter_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      or regexp_replace(coalesce(invitee_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;

  if p_target_role = 'manager' then
    delete from public.affiliation_manager_mappings
     where regexp_replace(coalesce(manager_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  end if;

  if cardinality(v_fc_ids) > 0 then
    delete from public.profiles where fc_id = any(v_fc_ids);
    delete from public.fc_profiles where id = any(v_fc_ids);
  end if;

  if p_target_role = 'admin' then
    delete from public.admin_accounts where id = p_target_id;
  elsif p_target_role = 'manager' then
    delete from public.manager_accounts where id = p_target_id;
  end if;
  get diagnostics v_deleted_count = row_count;

  if p_target_role = 'fc' then
    v_deleted_count := case
      when exists (select 1 from public.fc_profiles where id = p_target_id) then 0
      else 1
    end;
  end if;

  if v_deleted_count <> 1 then
    raise exception using errcode = 'P0002', message = 'account_delete_target_not_deleted';
  end if;

  insert into public.account_deletion_cleanup_outbox (
    cleanup_payload
  ) values (
    jsonb_build_object(
      'proof_paths', to_jsonb(v_proof_paths),
      'document_paths', to_jsonb(v_document_paths),
      'board_attachment_paths', to_jsonb(v_board_paths),
      'chat_file_urls', to_jsonb(v_chat_file_urls),
      'auth_user_ids', to_jsonb(v_auth_user_ids)
    )
  )
  returning id into v_cleanup_outbox_id;

  return jsonb_build_object(
    'deleted', true,
    'cleanup_outbox_id', v_cleanup_outbox_id,
    'proof_paths', to_jsonb(v_proof_paths),
    'document_paths', to_jsonb(v_document_paths),
    'board_attachment_paths', to_jsonb(v_board_paths),
    'chat_file_urls', to_jsonb(v_chat_file_urls),
    'auth_user_ids', to_jsonb(v_auth_user_ids)
  );
end;
$$;

revoke all on function public.delete_account_core_transaction_v1(
  text, uuid
) from public, anon, authenticated;
grant execute on function public.delete_account_core_transaction_v1(
  text, uuid
) to service_role;
