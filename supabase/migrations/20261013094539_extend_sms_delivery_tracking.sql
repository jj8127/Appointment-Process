-- Reuse the privacy-safe SMS delivery ledger for FC signup and password
-- recovery. The ledger stores provider metadata only: never a phone number,
-- OTP, or message body.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.platform_sms_delivery_attempts
  drop constraint platform_sms_delivery_attempts_purpose_check;
alter table public.platform_sms_delivery_attempts
  add constraint platform_sms_delivery_attempts_purpose_check
  check (purpose in ('signup','fc_signup','password_reset'));

create or replace function public.begin_platform_sms_delivery_attempt(
  p_purpose text
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  created_id uuid;
begin
  if p_purpose not in ('fc_signup','password_reset') then
    raise exception 'invalid_input';
  end if;

  insert into platform_sms_delivery_attempts(purpose)
    values(p_purpose)
    returning id into created_id;

  return jsonb_build_object('ok',true,'deliveryId',created_id);
end $$;

create or replace function public.finalize_platform_sms_delivery_attempt(
  p_delivery_id uuid,
  p_purpose text,
  p_state text,
  p_provider_request_id text default null,
  p_provider_status_code text default null,
  p_failure_reason text default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  updated_attempt uuid;
  checked_at timestamptz;
begin
  if p_delivery_id is null
    or p_purpose not in ('fc_signup','password_reset')
    or p_state not in ('accepted','unknown','rejected')
    or (p_provider_request_id is not null and (
      length(p_provider_request_id) not between 1 and 200
      or p_provider_request_id !~ '^[A-Za-z0-9._:-]+$'
    ))
    or (p_provider_status_code is not null and (
      length(p_provider_status_code) not between 1 and 40
      or p_provider_status_code !~ '^[A-Za-z0-9._:-]+$'
    ))
    or (p_failure_reason is not null and p_failure_reason not in (
      'missing_configuration','request_build_failed','provider_rejected',
      'invalid_provider_response','network_error','timeout'
    ))
    or (p_state='accepted' and (
      p_failure_reason is not null or not (
        (p_provider_status_code='202' and p_provider_request_id is not null)
        or (p_provider_status_code='simulated' and p_provider_request_id is null)
      )
    ))
    or (p_state='rejected' and (
      coalesce(p_failure_reason,'') not in (
        'missing_configuration','request_build_failed','provider_rejected'
      )
      or p_provider_request_id is not null
    ))
    or (p_state='unknown' and coalesce(p_failure_reason,'') not in (
      'invalid_provider_response','network_error','timeout'
    ))
  then
    raise exception 'invalid_input';
  end if;

  checked_at:=clock_timestamp();
  update platform_sms_delivery_attempts set
    state=p_state,
    provider_request_id=p_provider_request_id,
    provider_status_code=p_provider_status_code,
    failure_reason=p_failure_reason,
    updated_at=checked_at,
    completed_at=case when p_state in ('accepted','rejected') then checked_at else null end
  where id=p_delivery_id
    and purpose=p_purpose
    and state='pending'
  returning id into updated_attempt;

  if updated_attempt is null then
    return jsonb_build_object('ok',false,'code','delivery_not_pending');
  end if;
  return jsonb_build_object('ok',true);
end $$;

revoke all on function public.begin_platform_sms_delivery_attempt(text)
  from public,anon,authenticated;
grant execute on function public.begin_platform_sms_delivery_attempt(text)
  to service_role;
revoke all on function public.finalize_platform_sms_delivery_attempt(uuid,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.finalize_platform_sms_delivery_attempt(uuid,text,text,text,text,text)
  to service_role;
