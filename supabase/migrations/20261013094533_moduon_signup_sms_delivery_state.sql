-- Track provider acceptance without retaining phone numbers or message bodies.
-- The transient challenge owns the only link between a phone and an attempt.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table public.platform_sms_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('signup')),
  provider text not null default 'ncp_sens' check (provider = 'ncp_sens'),
  state text not null default 'pending'
    check (state in ('pending','accepted','unknown','rejected','delivered','undeliverable')),
  provider_request_id text,
  provider_status_code text,
  failure_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (provider_request_id is null or (
    length(provider_request_id) between 1 and 200
    and provider_request_id ~ '^[A-Za-z0-9._:-]+$'
  )),
  check (provider_status_code is null or (
    length(provider_status_code) between 1 and 40
    and provider_status_code ~ '^[A-Za-z0-9._:-]+$'
  )),
  check (failure_reason is null or failure_reason in (
    'missing_configuration','request_build_failed','provider_rejected','invalid_provider_response','network_error','timeout'
  )),
  check (
    (state='pending' and provider_request_id is null and provider_status_code is null
      and failure_reason is null and completed_at is null)
    or (state='accepted' and failure_reason is null and completed_at is not null and (
      (provider_status_code='202' and provider_request_id is not null)
      or (provider_status_code='simulated' and provider_request_id is null)
    ))
    or (state='rejected' and failure_reason in (
      'missing_configuration','request_build_failed','provider_rejected'
    ) and provider_request_id is null and completed_at is not null)
    or (state='unknown' and failure_reason in (
      'invalid_provider_response','network_error','timeout'
    ) and completed_at is null)
    or (state in ('delivered','undeliverable') and provider_request_id is not null and completed_at is not null)
  )
);
create unique index platform_sms_delivery_provider_request_unique
  on public.platform_sms_delivery_attempts(provider_request_id)
  where provider_request_id is not null;

alter table public.platform_signup_challenges
  add column delivery_id uuid references public.platform_sms_delivery_attempts(id) on delete set null;

create index platform_signup_challenges_delivery_idx
  on public.platform_signup_challenges(delivery_id)
  where delivery_id is not null;

create or replace function public.issue_platform_signup_otp(p_phone text,p_code_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  c platform_signup_challenges;
  checked_at timestamptz;
  issued_delivery_id uuid;
begin
  if p_phone is null or p_phone !~ '^[0-9]{11}$'
    or coalesce(p_code_hash,'') !~ '^[A-Za-z0-9+/]{43}=$'
  then raise exception 'invalid_input'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  checked_at:=clock_timestamp();

  if exists(select from platform_members where phone=p_phone) or
     exists(select from admin_accounts where phone=p_phone) or
     exists(select from manager_accounts where phone=p_phone) or
     exists(select from fc_profiles where phone=p_phone and signup_completed=true)
  then return jsonb_build_object('ok',false,'code','already_exists'); end if;

  select * into c from platform_signup_challenges where phone=p_phone for update;
  if found and c.locked_until>checked_at then
    return jsonb_build_object('ok',false,'code','locked');
  end if;
  if found and c.sent_at>checked_at-interval '60 seconds' then
    return jsonb_build_object('ok',false,'code','cooldown');
  end if;

  insert into platform_sms_delivery_attempts(purpose)
    values('signup') returning id into issued_delivery_id;
  insert into platform_signup_challenges(
    phone,code_hash,expires_at,sent_at,attempts,locked_until,consumed_member_id,delivery_id
  ) values(
    p_phone,p_code_hash,checked_at+interval '5 minutes',checked_at,0,null,null,issued_delivery_id
  ) on conflict(phone) do update set
    code_hash=excluded.code_hash,
    expires_at=excluded.expires_at,
    sent_at=excluded.sent_at,
    attempts=0,
    locked_until=null,
    consumed_member_id=null,
    delivery_id=excluded.delivery_id;

  return jsonb_build_object('ok',true,'deliveryId',issued_delivery_id);
end $$;

create or replace function public.finalize_platform_signup_otp_delivery(
  p_phone text,
  p_delivery_id uuid,
  p_state text,
  p_provider_request_id text default null,
  p_provider_status_code text default null,
  p_failure_reason text default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  c platform_signup_challenges;
  updated_attempt uuid;
  checked_at timestamptz;
begin
  if coalesce(p_phone,'') !~ '^[0-9]{11}$' or p_delivery_id is null
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
      'missing_configuration','request_build_failed','provider_rejected','invalid_provider_response','network_error','timeout'
    ))
    or (p_state='accepted' and (
      p_failure_reason is not null or not (
        (p_provider_status_code='202' and p_provider_request_id is not null)
        or (p_provider_status_code='simulated' and p_provider_request_id is null)
      )
    ))
    or (p_state='rejected' and (
      coalesce(p_failure_reason,'') not in ('missing_configuration','request_build_failed','provider_rejected')
      or p_provider_request_id is not null
    ))
    or (p_state='unknown' and coalesce(p_failure_reason,'') not in (
      'invalid_provider_response','network_error','timeout'
    ))
  then raise exception 'invalid_input'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  checked_at:=clock_timestamp();

  select * into c from platform_signup_challenges where phone=p_phone for update;
  if found and c.delivery_id is not distinct from p_delivery_id
    and c.consumed_member_id is not null
  then
    return jsonb_build_object('ok',false,'code','already_consumed');
  end if;

  update platform_sms_delivery_attempts set
    state=p_state,
    provider_request_id=p_provider_request_id,
    provider_status_code=p_provider_status_code,
    failure_reason=p_failure_reason,
    updated_at=checked_at,
    completed_at=case when p_state in ('accepted','rejected') then checked_at else null end
  where id=p_delivery_id and purpose='signup' and state='pending'
  returning id into updated_attempt;

  if updated_attempt is null then
    return jsonb_build_object('ok',false,'code','delivery_already_finalized');
  end if;

  if not found or c.delivery_id is distinct from p_delivery_id then
    return jsonb_build_object('ok',false,'code','stale_delivery');
  end if;

  if p_state='rejected' then
    delete from platform_signup_challenges
      where phone=p_phone and delivery_id=p_delivery_id;
  end if;
  return jsonb_build_object('ok',true,'current',true);
end $$;

alter table public.platform_sms_delivery_attempts enable row level security;
create or replace function public.cancel_password_reset_challenge(
  p_account_kind text,
  p_account_id uuid,
  p_phone text,
  p_token_hash text
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  account_table text;
  account_key text;
  account_row jsonb;
  profile_row public.fc_profiles%rowtype;
  member_row public.platform_members%rowtype;
  cancelled_id uuid;
  checked_at timestamptz;
begin
  if p_account_id is null or coalesce(p_phone,'') !~ '^[0-9]{11}$'
    or coalesce(p_token_hash,'') !~ '^[A-Za-z0-9+/]{43}=$'
  then return jsonb_build_object('ok',false,'code','invalid_request'); end if;

  case p_account_kind
    when 'admin' then account_table:='admin_accounts'; account_key:='id';
    when 'manager' then account_table:='manager_accounts'; account_key:='id';
    when 'fc' then account_table:='fc_credentials'; account_key:='fc_id';
    when 'member' then account_table:='platform_member_credentials'; account_key:='member_id';
    else return jsonb_build_object('ok',false,'code','invalid_request');
  end case;

  if p_account_kind='fc' then
    select * into profile_row from public.fc_profiles where id=p_account_id for update;
    if not found or profile_row.phone is distinct from p_phone
      or profile_row.signup_completed is distinct from true
    then return jsonb_build_object('ok',false,'code','account_unavailable'); end if;
  elsif p_account_kind='member' then
    select * into member_row from public.platform_members where id=p_account_id for update;
    if not found or member_row.phone is distinct from p_phone or not member_row.active or member_row.fc_id is not null
    then return jsonb_build_object('ok',false,'code','account_unavailable'); end if;
  end if;

  execute format(
    'select to_jsonb(a) from public.%I a where %I=$1 for update',
    account_table,account_key
  ) into account_row using p_account_id;
  if account_row is null
    or (p_account_kind not in ('fc','member') and (
      account_row->>'phone' is distinct from p_phone or account_row->>'active'='false'
    ))
  then return jsonb_build_object('ok',false,'code','account_unavailable'); end if;

  checked_at:=clock_timestamp();
  execute format(
    'update public.%I set reset_token_hash=null,reset_token_expires_at=null,
       reset_sent_at=null,reset_failed_count=0,updated_at=$3
     where %I=$1 and reset_token_hash=$2 returning %I',
    account_table,account_key,account_key
  ) into cancelled_id using p_account_id,p_token_hash,checked_at;

  if cancelled_id is null then
    return jsonb_build_object('ok',false,'code','stale_challenge');
  end if;
  return jsonb_build_object('ok',true,'cancelled',true);
end $$;


revoke all on public.platform_sms_delivery_attempts from public,anon,authenticated;
grant select,insert,update,delete on public.platform_sms_delivery_attempts to service_role;
revoke all on function public.issue_platform_signup_otp(text,text) from public,anon,authenticated;
grant execute on function public.issue_platform_signup_otp(text,text) to service_role;
revoke all on function public.finalize_platform_signup_otp_delivery(text,uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.finalize_platform_signup_otp_delivery(text,uuid,text,text,text,text)
  to service_role;
revoke all on function public.cancel_password_reset_challenge(text,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.cancel_password_reset_challenge(text,uuid,text,text)
  to service_role;


create or replace function public.cleanup_platform_auth_challenges()
returns void language sql security invoker set search_path=public,pg_temp as $$
  delete from platform_signup_challenges where expires_at<=now()
    and coalesce(locked_until,expires_at)<=now();
  update platform_member_credentials c set reset_token_hash=null,reset_token_expires_at=null,
    reset_sent_at=null,reset_failed_count=0
    from platform_members m where m.id=c.member_id and m.fc_id is null
    and (c.reset_token_expires_at<=now() or (c.reset_token_hash is null and c.reset_sent_at<=now()-interval '60 seconds'));
  delete from platform_sms_delivery_attempts where created_at<now()-interval '31 days';
$$;
revoke all on function public.cleanup_platform_auth_challenges() from public,anon,authenticated;
grant execute on function public.cleanup_platform_auth_challenges() to service_role;
