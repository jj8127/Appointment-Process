-- Common-member consent and recovery use the existing trusted Edge/session
-- boundary. No anon/authenticated table or RPC access and no new storage.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.platform_members
  add column terms_version text,
  add column staff_account_kind text check (staff_account_kind in ('admin','manager')),
  add column staff_account_id uuid,
  add constraint platform_staff_identity_complete check (
    (staff_account_kind is null)=(staff_account_id is null) and (fc_id is null or staff_account_id is null)),
  add constraint platform_staff_identity_unique unique(staff_account_kind,staff_account_id);
alter table public.platform_signup_challenges
  add column consumed_member_id uuid references public.platform_members(id) on delete cascade;
alter table public.platform_member_credentials
  add column password_set_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add column reset_token_hash text,
  add column reset_token_expires_at timestamptz,
  add column reset_sent_at timestamptz,
  add column reset_failed_count integer not null default 0 check (reset_failed_count between 0 and 5);

create or replace function public.enroll_platform_legacy_member(
  p_phone text,p_name text,p_fc_id uuid,p_terms_version text,p_account_kind text default null,p_account_id uuid default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; inviter uuid;
begin
  if p_phone is null or p_phone !~ '^[0-9]{11}$' or p_name is null or length(trim(p_name)) not between 1 and 80
    or p_terms_version is distinct from '2026-10-12' then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  if p_fc_id is not null then
    if (p_account_kind is not null and p_account_kind<>'fc') or (p_account_id is not null and p_account_id<>p_fc_id)
      then raise exception 'forbidden'; end if;
    perform from fc_profiles where id=p_fc_id and phone=p_phone and signup_completed for update;
    if not found then raise exception 'forbidden'; end if;
    select r.id into inviter from fc_profiles f join platform_members r on r.fc_id=f.recommender_fc_id
      where f.id=p_fc_id and r.active and r.terms_accepted_at is not null;
  elsif p_account_kind='admin' then
    perform from admin_accounts where id=p_account_id and phone=p_phone and active for update;
    if not found then raise exception 'forbidden'; end if;
  elsif p_account_kind='manager' then
    perform from manager_accounts where id=p_account_id and phone=p_phone and active for update;
    if not found then raise exception 'forbidden'; end if;
  else raise exception 'forbidden'; end if;
  insert into platform_members(phone,name,fc_id,referrer_id,terms_accepted_at,terms_version,staff_account_kind,staff_account_id)
    values(p_phone,trim(p_name),p_fc_id,inviter,clock_timestamp(),p_terms_version,
      case when p_fc_id is null then p_account_kind end,case when p_fc_id is null then p_account_id end)
    on conflict(phone) do nothing;
  select * into m from platform_members where phone=p_phone for update;
  if not m.active then raise exception 'forbidden'; end if;
  -- Explicit consent may follow a verified FC/staff role transition on the
  -- same phone. Keep the shared graph UUID, bind only the locked source above,
  -- and invalidate tokens backed by the previous canonical source.
  update platform_members set terms_accepted_at=case when terms_version=p_terms_version then terms_accepted_at else clock_timestamp() end,
    terms_version=p_terms_version,name=trim(p_name),fc_id=p_fc_id,
    staff_account_kind=case when p_fc_id is null then p_account_kind end,
    staff_account_id=case when p_fc_id is null then p_account_id end where id=m.id;
  delete from platform_member_credentials where member_id=m.id;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.enroll_platform_legacy_member(text,text,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.enroll_platform_legacy_member(text,text,uuid,text,text,uuid) to service_role;

create or replace function public.sync_platform_fc_member() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare mapped uuid;
begin
  if new.signup_completed=true and new.phone ~ '^[0-9]{11}$' then
    select id into mapped from platform_members where fc_id=new.id for update;
    if mapped is not null then
      update platform_members set phone=new.phone,name=coalesce(nullif(new.name,''),'회원') where id=mapped;
    else
      update platform_members set name=coalesce(nullif(new.name,''),'회원'),fc_id=new.id
        where phone=new.phone and active and terms_accepted_at is not null and fc_id is null and staff_account_id is null;
    end if;
    delete from platform_member_credentials where member_id=(select id from platform_members where fc_id=new.id);
  end if;
  return new;
end $$;

-- A common-service withdrawal leaves the insurance/staff account intact.
-- Retain only the existing UUID/referral/settlement links; remove identifying
-- details, credentials, consent and every receipt bound to this identity.
create or replace function public.delete_platform_member(p_member_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members;
begin
  select * into m from platform_members where id=p_member_id for update;
  if not found then raise exception 'member_unavailable'; end if;
  delete from platform_member_credentials where member_id=m.id;
  delete from platform_signup_challenges where phone=m.phone or consumed_member_id=m.id;
  update platform_service_applications set details='{"region":"삭제","requestType":"삭제"}'::jsonb,
    status=case when status='interest' then 'cancelled' else status end where member_id=m.id;
  update platform_members set phone=null,name='탈퇴 회원',active=false,fc_id=null,
    staff_account_kind=null,staff_account_id=null,terms_accepted_at=null,terms_version=null where id=m.id;
  return jsonb_build_object('ok',true,'deleted',true);
end $$;

-- Reuse the same erase operation when the underlying insurance or staff
-- account is deleted. Exact source IDs prevent cross-role phone ambiguity.
create or replace function public.erase_platform_fc_identity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare mapped uuid;
begin
  select id into mapped from platform_members where
    (tg_table_name='fc_profiles' and fc_id=old.id) or
    (staff_account_kind=case tg_table_name when 'admin_accounts' then 'admin' when 'manager_accounts' then 'manager' end
      and staff_account_id=old.id) for update;
  if mapped is not null then perform delete_platform_member(mapped); end if;
  delete from platform_signup_challenges where phone=old.phone;
  return old;
end $$;
create trigger platform_admin_delete_identity before delete on public.admin_accounts
for each row execute function public.erase_platform_fc_identity();
create trigger platform_manager_delete_identity before delete on public.manager_accounts
for each row execute function public.erase_platform_fc_identity();

create or replace function public.sync_platform_staff_member() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update platform_members set phone=new.phone,name=coalesce(nullif(new.name,''),'회원')
    where staff_account_kind=case tg_table_name when 'admin_accounts' then 'admin' else 'manager' end
    and staff_account_id=new.id and active;
  return new;
end $$;
revoke all on function public.sync_platform_staff_member() from public,anon,authenticated;
create trigger platform_admin_projection after update of phone,name on public.admin_accounts
for each row execute function public.sync_platform_staff_member();
create trigger platform_manager_projection after update of phone,name on public.manager_accounts
for each row execute function public.sync_platform_staff_member();

create or replace function public.register_platform_member(p_phone text,p_code_hash text,p_name text,
  p_password_hash text,p_password_salt text,p_referral_code text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c platform_signup_challenges; m platform_members; inviter uuid; checked_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  select * into c from platform_signup_challenges where phone=p_phone for update;
  checked_at:=clock_timestamp();
  if not found or c.expires_at<=checked_at then return jsonb_build_object('ok',false,'code','expired_code'); end if;
  if c.locked_until>checked_at then return jsonb_build_object('ok',false,'code','locked'); end if;
  if c.code_hash is distinct from p_code_hash then
    update platform_signup_challenges set attempts=attempts+1,
      locked_until=case when attempts>=4 then checked_at+interval '10 minutes' else null end where phone=p_phone;
    return jsonb_build_object('ok',false,'code','invalid_code');
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80
    or coalesce(p_password_hash,'') !~ '^[A-Za-z0-9+/]{43}=$'
    or coalesce(p_password_salt,'') !~ '^[A-Za-z0-9+/]{22}==$' then raise exception 'invalid_input'; end if;
  -- An uncertain successful signup may be retried during the original OTP
  -- window only with the same verified phone, code and current password.
  -- The already-consumed challenge never creates another account.
  if c.consumed_member_id is not null then
    select * into m from platform_members where id=c.consumed_member_id and phone=p_phone and active and fc_id is null;
    if m.id is null or not exists(select from platform_member_credentials
      where member_id=m.id and password_hash=p_password_hash and password_salt=p_password_salt)
    then return jsonb_build_object('ok',false,'code','already_exists'); end if;
    return jsonb_build_object('ok',true,'memberId',m.id,'displayName',m.name,
      'sessionVersion',(select session_version from platform_member_credentials where member_id=m.id));
  end if;
  if exists(select from platform_members where phone=p_phone) or exists(select from fc_profiles where phone=p_phone and signup_completed)
    or exists(select from admin_accounts where phone=p_phone) or exists(select from manager_accounts where phone=p_phone)
  then return jsonb_build_object('ok',false,'code','already_exists'); end if;
  if nullif(trim(p_referral_code),'') is not null then
    select id into inviter from platform_members where referral_code=upper(trim(p_referral_code)) and active and terms_accepted_at is not null;
    if inviter is null then
      select m2.id into inviter from referral_codes r join platform_members m2 on m2.fc_id=r.fc_id
      where r.code=upper(trim(p_referral_code)) and r.is_active and m2.active and m2.terms_accepted_at is not null;
    end if;
    if inviter is null then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  end if;
  insert into platform_members(phone,name,referrer_id,terms_accepted_at,terms_version)
    values(p_phone,trim(p_name),inviter,checked_at,'2026-10-12') returning * into m;
  insert into platform_member_credentials(member_id,password_hash,password_salt) values(m.id,p_password_hash,p_password_salt);
  update platform_signup_challenges set consumed_member_id=m.id where phone=p_phone;
  return jsonb_build_object('ok',true,'memberId',m.id,'displayName',m.name,'sessionVersion',0);
end $$;

-- Reuse the existing reset lock, counters, expiry and consumption protocol.
create or replace function public.process_password_reset_challenge(
  p_action text,
  p_account_kind text,
  p_account_id uuid,
  p_phone text,
  p_token_hash text,
  p_password_hash text default null,
  p_password_salt text default null
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  account_table text;
  account_key text;
  account_row jsonb;
  profile_row public.fc_profiles%rowtype;
  member_row public.platform_members%rowtype;
  checked_at timestamptz;
  failed_attempts integer;
begin
  if coalesce(p_action, '') not in ('issue', 'consume')
    or p_account_id is null
    or coalesce(p_phone, '') !~ '^[0-9]{11}$'
    or coalesce(p_token_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
    or (p_action = 'consume' and (
      coalesce(p_password_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
      or coalesce(p_password_salt, '') !~ '^[A-Za-z0-9+/]{22}==$'
    )) then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  case p_account_kind
    when 'admin' then account_table := 'admin_accounts'; account_key := 'id';
    when 'manager' then account_table := 'manager_accounts'; account_key := 'id';
    when 'fc' then account_table := 'fc_credentials'; account_key := 'fc_id';
    when 'member' then account_table := 'platform_member_credentials'; account_key := 'member_id';
    else return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end case;

  -- Match existing FC lifecycle lock order: profile, then credentials. This
  -- also prevents completion/phone changes while a challenge is processed.
  if p_account_kind = 'fc' then
    select * into profile_row from public.fc_profiles
    where id = p_account_id for update;
    if not found or profile_row.phone is distinct from p_phone
      or profile_row.signup_completed is distinct from true then
      return jsonb_build_object('ok', false, 'code', 'account_unavailable');
    end if;
  end if;

  if p_account_kind = 'member' then
    select * into member_row from public.platform_members where id=p_account_id for update;
    if not found or member_row.phone is distinct from p_phone or not member_row.active or member_row.fc_id is not null then
      return jsonb_build_object('ok',false,'code','account_unavailable');
    end if;
  end if;

  execute format(
    'select to_jsonb(a) from public.%I a where %I = $1 for update',
    account_table, account_key
  ) into account_row using p_account_id;
  if account_row is null
    or account_row->>'password_set_at' is null
    or (p_account_kind not in ('fc','member') and (
      account_row->>'phone' is distinct from p_phone
      or account_row->>'active' = 'false'
    )) then
    return jsonb_build_object('ok', false, 'code', 'account_unavailable');
  end if;

  -- Evaluate expiry/cooldown after any lock wait, not at transaction start.
  checked_at := clock_timestamp();
  if p_action = 'issue' then
    if (account_row->>'reset_sent_at')::timestamptz > checked_at - interval '60 seconds' then
      return jsonb_build_object('ok', false, 'code', 'cooldown');
    end if;
    execute format(
      'update public.%I set reset_token_hash = $2,
       reset_token_expires_at = $3::timestamptz + interval ''15 minutes'',
       reset_sent_at = $3, reset_failed_count = 0, updated_at = $3
       where %I = $1', account_table, account_key
    ) using p_account_id, p_token_hash, checked_at;
    return jsonb_build_object('ok', true);
  end if;

  failed_attempts := (account_row->>'reset_failed_count')::integer;
  if failed_attempts >= 5 then
    return jsonb_build_object('ok', false, 'code', 'attempts_exhausted');
  end if;
  if account_row->>'reset_token_hash' is null
    or account_row->>'reset_token_expires_at' is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if (account_row->>'reset_token_expires_at')::timestamptz <= checked_at then
    return jsonb_build_object('ok', false, 'code', 'expired_token');
  end if;
  if account_row->>'reset_token_hash' is distinct from p_token_hash then
    failed_attempts := failed_attempts + 1;
    execute format(
      'update public.%I set reset_failed_count = $2, updated_at = $3 where %I = $1',
      account_table, account_key
    ) using p_account_id, failed_attempts, checked_at;
    -- Return, do not raise: a raised exception would roll back the counter.
    return jsonb_build_object('ok', false, 'code',
      case when failed_attempts >= 5 then 'attempts_exhausted' else 'invalid_token' end);
  end if;

  execute format(
    'update public.%I set password_hash = $2, password_salt = $3,
     password_set_at = $4, failed_count = 0, locked_until = null,
     reset_token_hash = null, reset_token_expires_at = null,
     reset_failed_count = 0, updated_at = $4%s where %I = $1',
    account_table,
    case when p_account_kind = 'fc' then
      ', must_change_password = false, temporary_password_issued_at = null'
      else '' end,
    account_key
  ) using p_account_id, p_password_hash, p_password_salt, checked_at;
  -- Preserve reset_sent_at so success cannot bypass the issuance cooldown.
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.process_password_reset_challenge(text, text, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.process_password_reset_challenge(text, text, uuid, text, text, text, text)
  to service_role;

-- Delete signup phone/digest receipts once their 5-minute window ends. A
-- failed-guess lock survives until its own 10-minute expiry. Clear consumer
-- reset digests after the 15-minute window and completed cooldown state after
-- 60 seconds. The scheduled task adds at most five minutes of cleanup lag.
create or replace function public.cleanup_platform_auth_challenges()
returns void language sql security invoker set search_path=public,pg_temp as $$
  delete from platform_signup_challenges where expires_at<=now()
    and coalesce(locked_until,expires_at)<=now();
  update platform_member_credentials c set reset_token_hash=null,reset_token_expires_at=null,
    reset_sent_at=null,reset_failed_count=0
    from platform_members m where m.id=c.member_id and m.fc_id is null
    and (c.reset_token_expires_at<=now() or (c.reset_token_hash is null and c.reset_sent_at<=now()-interval '60 seconds'));
$$;
revoke all on function public.cleanup_platform_auth_challenges() from public,anon,authenticated;
grant execute on function public.cleanup_platform_auth_challenges() to service_role;
