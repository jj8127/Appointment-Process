-- Canonical month ownership for exam rounds, including date-TBD rounds.
-- The migration preserves history and aborts rather than guessing whenever
-- existing registrations do not determine one unambiguous month.

alter table public.exam_rounds
  add column if not exists exam_month date;

alter table public.exam_registrations
  add column if not exists exam_type text;

-- Registration type is a durable snapshot derived only from its referenced
-- round. Never infer it from labels, subjects, or caller input.
update public.exam_registrations registration
   set exam_type = round_row.exam_type
  from public.exam_rounds round_row
 where round_row.id = registration.round_id
   and registration.exam_type is null;

update public.exam_rounds
   set exam_month = date_trunc('month', exam_date)::date
 where exam_date is not null
   and exam_month is null;

-- A referenced TBD round inherits its month only when every registration
-- agrees on exactly one already-recorded month.
with registered_round_months as (
  select
    round_row.id as round_id,
    min(registration.exam_month) as resolved_exam_month,
    count(distinct registration.exam_month) as distinct_exam_month_count
  from public.exam_rounds round_row
  join public.exam_registrations registration
    on registration.round_id = round_row.id
  where round_row.exam_date is null
    and round_row.exam_month is null
    and registration.exam_month is not null
  group by round_row.id
)
update public.exam_rounds round_row
   set exam_month = resolved.resolved_exam_month
  from registered_round_months resolved
 where round_row.id = resolved.round_id
   and resolved.distinct_exam_month_count = 1;

-- Only unused legacy TBD rounds may fall back to their label. The expression
-- accepts a leading `YY년 M월`, `YYYY년 M월`, or `M월`. When the year is
-- omitted, choose the first matching month on or after the deadline month so
-- December -> January resolves across the year boundary deterministically.
with parsed_unused_tbd_rounds as (
  select
    round_row.id as round_id,
    round_row.registration_deadline,
    regexp_match(
      btrim(coalesce(round_row.round_label, '')),
      '^(?:([0-9]{2}|[0-9]{4})년[[:space:]]*)?([0-9]{1,2})월(?:[[:space:]]|$)'
    ) as date_parts
  from public.exam_rounds round_row
  where round_row.exam_date is null
    and round_row.exam_month is null
    and not exists (
      select 1
        from public.exam_registrations registration
       where registration.round_id = round_row.id
    )
),
resolved_unused_tbd_rounds as (
  select
    round_id,
    registration_deadline,
    case
      when date_parts[1] is null
        then extract(year from registration_deadline)::integer
      when char_length(date_parts[1]) = 2
        then 2000 + date_parts[1]::integer
      else date_parts[1]::integer
    end as base_year,
    date_parts[1] is null as year_was_omitted,
    date_parts[2]::integer as exam_month_number
  from parsed_unused_tbd_rounds
  where date_parts is not null
),
canonical_unused_tbd_rounds as (
  select
    round_id,
    case
      when year_was_omitted
       and exam_month_number < extract(month from registration_deadline)::integer
        then make_date(base_year + 1, exam_month_number, 1)
      else make_date(base_year, exam_month_number, 1)
    end as resolved_exam_month
  from resolved_unused_tbd_rounds
  where base_year between 2000 and 2100
    and exam_month_number between 1 and 12
)
update public.exam_rounds round_row
   set exam_month = resolved.resolved_exam_month
  from canonical_unused_tbd_rounds resolved
 where round_row.id = resolved.round_id;

do $exam_round_month_preflight$
begin
  if exists (
    select 1
      from public.exam_rounds round_row
     where round_row.exam_month is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'exam_round_month_backfill_unresolved';
  end if;

  if exists (
    select 1
      from public.exam_registrations registration
      join public.exam_rounds round_row
        on round_row.id = registration.round_id
     where registration.status in ('applied', 'confirmed', 'completed', 'no_show')
       and registration.exam_month is distinct from round_row.exam_month
  ) then
    raise exception using
      errcode = '23514',
      message = 'exam_round_month_active_registration_drift';
  end if;

  if exists (
    select 1
      from public.exam_registrations registration
     where registration.exam_type is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'exam_registration_type_backfill_unresolved';
  end if;

  if exists (
    select 1
      from public.exam_registrations registration
     where not exists (
       select 1
         from public.exam_rounds round_row
        where round_row.id = registration.round_id
          and round_row.exam_type = registration.exam_type
     )
  ) then
    raise exception using
      errcode = '23514',
      message = 'exam_registration_round_type_drift';
  end if;

  if exists (
    select 1
      from public.exam_registrations registration
     where registration.fc_id is not null
       and registration.status in ('applied', 'confirmed', 'completed', 'no_show')
       and registration.monthly_slot_policy_version = 1
     group by registration.fc_id, registration.exam_month, registration.exam_type
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'exam_registration_type_active_collision';
  end if;

end
$exam_round_month_preflight$;

alter table public.exam_rounds
  alter column exam_month set not null;

alter table public.exam_rounds
  drop constraint if exists exam_rounds_exam_month_start_check;
alter table public.exam_rounds
  add constraint exam_rounds_exam_month_start_check
  check (exam_month = date_trunc('month', exam_month)::date);

alter table public.exam_rounds
  drop constraint if exists exam_rounds_exam_date_month_check;
alter table public.exam_rounds
  add constraint exam_rounds_exam_date_month_check
  check (
    exam_date is null
    or exam_month = date_trunc('month', exam_date)::date
  );

alter table public.exam_registrations
  alter column exam_type set not null;

alter table public.exam_registrations
  drop constraint if exists exam_registrations_exam_type_check;
alter table public.exam_registrations
  add constraint exam_registrations_exam_type_check
  check (exam_type in ('life', 'nonlife'));

create unique index if not exists idx_exam_rounds_id_exam_type
  on public.exam_rounds (id, exam_type);

alter table public.exam_registrations
  drop constraint if exists exam_registrations_round_exam_type_fkey;
alter table public.exam_registrations
  add constraint exam_registrations_round_exam_type_fkey
  foreign key (round_id, exam_type)
  references public.exam_rounds (id, exam_type)
  on delete restrict;

drop index if exists public.idx_exam_registrations_active_fc_exam_month;
drop index if exists public.idx_exam_registrations_active_fc_exam_month_type;

create unique index idx_exam_registrations_active_fc_exam_month_type
  on public.exam_registrations (fc_id, exam_month, exam_type)
  where status in ('applied', 'confirmed', 'completed', 'no_show')
    and monthly_slot_policy_version = 1;

create or replace function public.save_exam_round_atomic_v2(
  p_round_id uuid,
  p_exam_date date,
  p_exam_month date,
  p_registration_deadline date,
  p_round_label text,
  p_exam_type text,
  p_notes text,
  p_locations text[]
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_round_id uuid;
  v_location_id uuid;
  v_location_name text;
  v_location_position bigint;
  v_locations text[];
  v_location_count integer;
  v_distinct_location_count integer;
  v_updated_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_registration_deadline is null then
    raise exception 'registration deadline required' using errcode = '22023';
  end if;
  if p_exam_month is null
     or p_exam_month <> date_trunc('month', p_exam_month)::date then
    raise exception 'invalid exam month' using errcode = '22023';
  end if;
  if p_exam_date is not null
     and p_exam_month <> date_trunc('month', p_exam_date)::date then
    raise exception 'exam date and month mismatch' using errcode = '22023';
  end if;
  if p_exam_date is not null and p_registration_deadline > p_exam_date then
    raise exception 'registration deadline cannot follow exam date' using errcode = '22023';
  end if;
  if p_round_label is null
     or btrim(p_round_label) = ''
     or char_length(btrim(p_round_label)) > 120 then
    raise exception 'invalid round label' using errcode = '22023';
  end if;
  if p_exam_type not in ('life', 'nonlife') then
    raise exception 'invalid exam type' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 2000 then
    raise exception 'invalid notes' using errcode = '22023';
  end if;

  v_location_count := coalesce(cardinality(p_locations), 0);
  if v_location_count < 1 or v_location_count > 50 then
    raise exception 'invalid location count' using errcode = '22023';
  end if;
  if exists (
    select 1
      from unnest(p_locations) as requested(location_name)
     where requested.location_name is null
        or btrim(requested.location_name) = ''
        or char_length(btrim(requested.location_name)) > 120
  ) then
    raise exception 'invalid location name' using errcode = '22023';
  end if;

  select array_agg(btrim(requested.location_name) order by requested.position),
         count(distinct btrim(requested.location_name))::integer
    into v_locations, v_distinct_location_count
    from unnest(p_locations) with ordinality as requested(location_name, position);

  if v_distinct_location_count <> v_location_count then
    raise exception 'duplicate location name' using errcode = '22023';
  end if;

  if p_round_id is null then
    insert into public.exam_rounds (
      exam_date,
      exam_month,
      registration_deadline,
      round_label,
      exam_type,
      notes
    ) values (
      p_exam_date,
      p_exam_month,
      p_registration_deadline,
      btrim(p_round_label),
      p_exam_type,
      p_notes
    )
    returning id into v_round_id;
  else
    update public.exam_rounds
       set exam_date = p_exam_date,
           exam_month = p_exam_month,
           registration_deadline = p_registration_deadline,
           round_label = btrim(p_round_label),
           exam_type = p_exam_type,
           notes = p_notes
     where id = p_round_id;

    get diagnostics v_updated_count = row_count;
    if v_updated_count <> 1 then
      raise exception 'exam round not found' using errcode = 'P0002';
    end if;
    v_round_id := p_round_id;
  end if;

  for v_location_name, v_location_position in
    select requested.location_name, requested.position
      from unnest(v_locations) with ordinality as requested(location_name, position)
  loop
    v_location_id := null;
    select location.id
      into v_location_id
      from public.exam_locations location
     where location.round_id = v_round_id
       and location.location_name = v_location_name
     order by location.created_at, location.id
     limit 1
     for update;

    if v_location_id is null then
      insert into public.exam_locations (round_id, location_name, sort_order)
      values (v_round_id, v_location_name, (v_location_position - 1)::integer);
    else
      update public.exam_locations
         set sort_order = (v_location_position - 1)::integer
       where id = v_location_id;
    end if;
  end loop;

  delete from public.exam_locations location
   where location.round_id = v_round_id
     and not (btrim(location.location_name) = any(v_locations))
     and not exists (
       select 1
         from public.exam_registrations registration
        where registration.location_id = location.id
     );

  return v_round_id;
end;
$$;

revoke all on function public.save_exam_round_atomic_v2(
  uuid, date, date, date, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.save_exam_round_atomic_v2(
  uuid, date, date, date, text, text, text, text[]
) to service_role;

create or replace function public.save_exam_round_atomic(
  p_round_id uuid,
  p_exam_date date,
  p_registration_deadline date,
  p_round_label text,
  p_exam_type text,
  p_notes text,
  p_locations text[]
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_exam_month date;
  v_existing_exam_date date;
begin
  if p_round_id is not null then
    select round_row.exam_date,
           round_row.exam_month
      into v_existing_exam_date,
           v_exam_month
      from public.exam_rounds round_row
     where round_row.id = p_round_id;

    if not found then
      raise exception 'exam round not found' using errcode = 'P0002';
    end if;

    if v_existing_exam_date is null
       and p_exam_date is not null then
      raise exception using
        errcode = '22023',
        message = 'exam_month_required_for_tbd_round';
    end if;
  end if;

  if p_exam_date is not null then
    v_exam_month := date_trunc('month', p_exam_date)::date;
  end if;

  if v_exam_month is null then
    raise exception using
      errcode = '22023',
      message = 'exam_month_required_for_tbd_round';
  end if;

  return public.save_exam_round_atomic_v2(
    p_round_id,
    p_exam_date,
    v_exam_month,
    p_registration_deadline,
    p_round_label,
    p_exam_type,
    p_notes,
    p_locations
  );
end;
$$;

revoke all on function public.save_exam_round_atomic(
  uuid, date, date, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.save_exam_round_atomic(
  uuid, date, date, text, text, text, text[]
) to service_role;

create or replace function public.prevent_exam_history_drift()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'exam_rounds' then
    if tg_op = 'DELETE' and exists (
      select 1 from public.exam_registrations where round_id = old.id
    ) then
      raise exception using errcode = '55000', message = 'exam_round_has_registrations';
    end if;
    if tg_op = 'UPDATE'
       and exists (
         select 1 from public.exam_registrations where round_id = old.id
       )
       and (
         new.exam_type is distinct from old.exam_type
         or new.exam_month is distinct from old.exam_month
         or (
           new.exam_date is distinct from old.exam_date
           and not (
             old.exam_date is null
             and new.exam_date is not null
             and date_trunc('month', new.exam_date)::date = old.exam_month
           )
         )
       ) then
      raise exception using errcode = '55000', message = 'exam_round_history_locked';
    end if;
  elsif tg_table_name = 'exam_locations' then
    if tg_op = 'DELETE' and exists (
      select 1 from public.exam_registrations where location_id = old.id
    ) then
      raise exception using errcode = '55000', message = 'exam_location_has_registrations';
    end if;
    if tg_op = 'UPDATE'
       and new.round_id is distinct from old.round_id
       and exists (
         select 1 from public.exam_registrations where location_id = old.id
       ) then
      raise exception using errcode = '55000', message = 'exam_location_history_locked';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.prevent_exam_history_drift()
  from public, anon, authenticated;
grant execute on function public.prevent_exam_history_drift()
  to service_role;

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
returns table (registration_id uuid, previous_proof_path text)
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

  select round_row.* into v_round
    from public.exam_rounds round_row
   where round_row.id = p_round_id
   for share;
  if v_round.id is null
     or v_round.exam_month is null
     or v_round.exam_type is null
     or v_round.exam_type not in ('life', 'nonlife') then
    raise exception using errcode = '22023', message = 'invalid_exam_round';
  end if;
  if v_round.registration_deadline < current_date then
    raise exception using errcode = '55000', message = 'exam_round_closed';
  end if;
  if not exists (
    select 1 from public.exam_locations
     where id = p_location_id and round_id = p_round_id
  ) then
    raise exception using errcode = '23503', message = 'invalid_exam_location';
  end if;

  v_exam_month := v_round.exam_month;
  perform pg_advisory_xact_lock(
    hashtextextended(p_fc_id::text || ':' || v_exam_month::text, 0)
  );

  select registration.* into v_registration
    from public.exam_registrations registration
   where registration.fc_id = p_fc_id
     and registration.exam_month = v_exam_month
     and registration.exam_type = v_round.exam_type
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
    select upload.* into v_upload
      from public.exam_payment_proof_uploads upload
     where upload.id = p_upload_id and upload.fc_id = p_fc_id
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
      resident_id, fc_id, round_id, location_id, exam_month, exam_type, status,
      is_confirmed, includes_primary_exam, is_third_exam, fee_paid_date,
      payment_proof_attached, payment_proof_policy_version
    ) values (
      btrim(p_resident_id), p_fc_id, p_round_id, p_location_id, v_exam_month,
      v_round.exam_type,
      'applied', false, p_includes_primary_exam, p_is_third_exam,
      p_fee_paid_date, p_upload_id is not null, 1
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
           payment_proof_attached = payment_proof_attached or p_upload_id is not null,
           payment_proof_policy_version = 1
     where id = v_registration.id
    returning * into v_registration;
    v_action := 'updated';
  end if;

  if p_upload_id is not null and v_upload.status = 'pending' then
    select proof.storage_path into v_previous_proof_path
      from public.exam_payment_proof_uploads proof
     where proof.registration_id = v_registration.id and proof.status = 'attached'
     for update;
    update public.exam_payment_proof_uploads proof
       set status = 'replaced'
     where proof.registration_id = v_registration.id and proof.status = 'attached';
    update public.exam_payment_proof_uploads proof
       set status = 'attached', registration_id = v_registration.id, consumed_at = now()
     where proof.id = p_upload_id;
  end if;

  insert into public.exam_registration_decision_events (
    registration_id, action, from_status, to_status, actor_type, actor_fc_id_snapshot
  ) values (
    v_registration.id, v_action,
    case when v_action = 'updated' then 'applied' else null end,
    'applied', 'fc', p_fc_id
  );

  return query select v_registration.id, v_previous_proof_path;
end;
$$;

revoke all on function public.submit_exam_registration_with_payment_proof_v2(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid
) from public, anon, authenticated;
grant execute on function public.submit_exam_registration_with_payment_proof_v2(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid
) to service_role;

create or replace function public.submit_exam_registration_with_payment_proof_v3(
  p_fc_id uuid,
  p_resident_id text,
  p_round_id uuid,
  p_location_id uuid,
  p_includes_primary_exam boolean,
  p_is_third_exam boolean,
  p_fee_paid_date date,
  p_upload_id uuid,
  p_actor_type text,
  p_actor_admin_id uuid,
  p_actor_manager_id uuid,
  p_actor_fc_id uuid
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
    raise exception using errcode = '22023', message = 'invalid_exam_target';
  end if;
  if not exists (
    select 1
      from public.fc_profiles profile
     where profile.id = p_fc_id
       and profile.signup_completed = true
       and profile.is_manager_referral_shadow = false
       and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g')
         = regexp_replace(p_resident_id, '[^0-9]', '', 'g')
       and (
         p_actor_type = 'fc'
         or (
           coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
           and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
           and not exists (
             select 1
               from public.manager_accounts manager_target
              where manager_target.active = true
                and regexp_replace(coalesce(manager_target.phone, ''), '[^0-9]', '', 'g')
                  = regexp_replace(p_resident_id, '[^0-9]', '', 'g')
           )
           and not exists (
             select 1
               from public.admin_accounts staff_target
              where staff_target.active = true
                and regexp_replace(coalesce(staff_target.phone, ''), '[^0-9]', '', 'g')
                  = regexp_replace(p_resident_id, '[^0-9]', '', 'g')
           )
         )
       )
  ) then
    raise exception using errcode = '42501', message = 'invalid_exam_target';
  end if;
  if not coalesce(p_includes_primary_exam, false)
     and not coalesce(p_is_third_exam, false) then
    raise exception using errcode = '23514', message = 'exam_subject_required';
  end if;
  if p_fee_paid_date is not null and p_fee_paid_date > current_date then
    raise exception using errcode = '22023', message = 'invalid_fee_paid_date';
  end if;

  if p_actor_type = 'fc' then
    if p_actor_fc_id is distinct from p_fc_id
       or p_actor_admin_id is not null
       or p_actor_manager_id is not null then
      raise exception using errcode = '42501', message = 'invalid_exam_actor';
    end if;
  elsif p_actor_type = 'manager' then
    if p_actor_manager_id is null
       or p_actor_admin_id is not null
       or p_actor_fc_id is not null
       or not exists (
         select 1
           from public.manager_accounts manager
          where manager.id = p_actor_manager_id
            and manager.active = true
       ) then
      raise exception using errcode = '42501', message = 'invalid_exam_actor';
    end if;
  elsif p_actor_type in ('admin', 'developer') then
    if p_actor_admin_id is null
       or p_actor_manager_id is not null
       or p_actor_fc_id is not null
       or not exists (
         select 1
           from public.admin_accounts admin_row
          where admin_row.id = p_actor_admin_id
            and admin_row.active = true
            and (
              (p_actor_type = 'developer' and admin_row.staff_type = 'developer')
              or (
                p_actor_type = 'admin'
                and coalesce(admin_row.staff_type, 'admin') = 'admin'
              )
            )
       ) then
      raise exception using errcode = '42501', message = 'invalid_exam_actor';
    end if;
  else
    raise exception using errcode = '42501', message = 'invalid_exam_actor';
  end if;

  select round_row.*
    into v_round
    from public.exam_rounds round_row
   where round_row.id = p_round_id
   for share;

  if v_round.id is null
     or v_round.exam_month is null
     or v_round.exam_type is null
     or v_round.exam_type not in ('life', 'nonlife') then
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

  v_exam_month := v_round.exam_month;
  perform pg_advisory_xact_lock(
    hashtextextended(p_fc_id::text || ':' || v_exam_month::text, 0)
  );

  select registration.*
    into v_registration
    from public.exam_registrations registration
   where registration.fc_id = p_fc_id
     and registration.exam_month = v_exam_month
     and registration.exam_type = v_round.exam_type
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
      exam_type,
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
      v_round.exam_type,
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
           fee_paid_date = coalesce(v_registration.fee_paid_date, p_fee_paid_date),
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
    actor_admin_id_snapshot,
    actor_manager_id_snapshot,
    actor_fc_id_snapshot,
    target_fc_id_snapshot
  ) values (
    v_registration.id,
    v_action,
    case when v_action = 'updated' then 'applied' else null end,
    'applied',
    p_actor_type,
    p_actor_admin_id,
    p_actor_manager_id,
    p_actor_fc_id,
    p_fc_id
  );

  return query
  select v_registration.id, v_previous_proof_path;
end;
$$;

revoke all on function public.submit_exam_registration_with_payment_proof_v3(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid, text, uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.submit_exam_registration_with_payment_proof_v3(
  uuid, text, uuid, uuid, boolean, boolean, date, uuid, text, uuid, uuid, uuid
) to service_role;
