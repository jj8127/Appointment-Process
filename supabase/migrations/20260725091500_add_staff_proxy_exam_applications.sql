-- Staff-assisted exam applications.
-- Historical fee_paid_date values are retained, while new v3 submissions rely
-- on the mandatory payment proof and store no manually entered payment date.

alter table public.exam_registration_decision_events
  add column if not exists actor_manager_id_snapshot uuid;

alter table public.exam_registration_decision_events
  add column if not exists target_fc_id_snapshot uuid;

alter table public.exam_registration_decision_events
  drop constraint if exists exam_registration_decision_events_actor_type_check;

alter table public.exam_registration_decision_events
  add constraint exam_registration_decision_events_actor_type_check
  check (actor_type in ('fc', 'manager', 'admin', 'developer', 'service'));

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
