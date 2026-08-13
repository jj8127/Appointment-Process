-- Fix PL/pgSQL output-column ambiguity in the payment-proof registration RPC.
-- The function returns a column named registration_id, so references to the
-- upload table's registration_id must always use a table qualifier.

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
    select proof.storage_path
      into v_previous_proof_path
      from public.exam_payment_proof_uploads as proof
     where proof.registration_id = v_registration.id
       and proof.status = 'attached'
     for update;

    update public.exam_payment_proof_uploads as proof
       set status = 'replaced'
     where proof.registration_id = v_registration.id
       and proof.status = 'attached';

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
