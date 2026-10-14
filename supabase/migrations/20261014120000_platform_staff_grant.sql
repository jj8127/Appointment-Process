-- Partner-service staff rights attach to an existing common member. The
-- operator grants them manually; the member keeps exactly one password, which
-- moves to the staff account as the single credential authority (the same
-- hand-off enroll_platform_insurance_v1 uses for FC registration).
set local lock_timeout='3s';
set local statement_timeout='30s';

-- A staff row must never shadow a common member's phone. Otherwise the common
-- password keeps winning at login and the staff session is unreachable.
create or replace function public.guard_platform_staff_phone() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare kind text:=case tg_table_name when 'admin_accounts' then 'admin' else 'manager' end;
begin
  if exists(select from platform_members m where m.active
    and m.phone=regexp_replace(coalesce(new.phone,''),'[^0-9]','','g')
    and (m.staff_account_kind is distinct from kind or m.staff_account_id is distinct from new.id)) then
    raise exception 'platform_member_phone_requires_grant';
  end if;
  return new;
end $$;
revoke all on function public.guard_platform_staff_phone() from public,anon,authenticated;
drop trigger if exists platform_admin_phone_guard on public.admin_accounts;
create trigger platform_admin_phone_guard before insert on public.admin_accounts
for each row execute function public.guard_platform_staff_phone();
drop trigger if exists platform_admin_phone_change_guard on public.admin_accounts;
create trigger platform_admin_phone_change_guard before update of phone on public.admin_accounts
for each row when (old.phone is distinct from new.phone) execute function public.guard_platform_staff_phone();
drop trigger if exists platform_manager_phone_guard on public.manager_accounts;
create trigger platform_manager_phone_guard before insert on public.manager_accounts
for each row execute function public.guard_platform_staff_phone();
drop trigger if exists platform_manager_phone_change_guard on public.manager_accounts;
create trigger platform_manager_phone_change_guard before update of phone on public.manager_accounts
for each row when (old.phone is distinct from new.phone) execute function public.guard_platform_staff_phone();

-- p_existing_account_id binds a pre-existing unbound staff row on the same
-- phone instead of creating one; its old password is replaced by the common one.
create or replace function public.grant_platform_staff_account_v1(
  p_member_id uuid,p_account_kind text,p_staff_type text default 'admin',p_existing_account_id uuid default null
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; c platform_member_credentials; account_id uuid; created boolean:=false; found_account boolean;
begin
  if p_member_id is null or p_account_kind is null or p_account_kind not in ('admin','manager')
    or (p_account_kind='admin' and coalesce(p_staff_type,'') not in ('admin','developer')) then raise exception 'invalid_input'; end if;
  select * into m from platform_members where id=p_member_id;
  if not found or not m.active or m.phone is null then return jsonb_build_object('ok',false,'code','member_unavailable'); end if;
  perform pg_advisory_xact_lock(hashtextextended(m.phone,741012));
  select * into m from platform_members where id=p_member_id and active for update;
  if not found then return jsonb_build_object('ok',false,'code','member_unavailable'); end if;
  if m.staff_account_id is not null then
    if m.staff_account_kind=p_account_kind and (p_existing_account_id is null or p_existing_account_id=m.staff_account_id) then
      return jsonb_build_object('ok',true,'accountKind',m.staff_account_kind,'accountId',m.staff_account_id,'alreadyGranted',true); end if;
    return jsonb_build_object('ok',false,'code','staff_already_bound');
  end if;
  -- An FC becoming staff is a separate, undecided policy.
  if m.fc_id is not null or exists(select from fc_profiles where phone=m.phone and signup_completed)
    then return jsonb_build_object('ok',false,'code','fc_member_not_supported'); end if;
  if m.terms_accepted_at is null and m.terms_basis is distinct from 'company_attested_import'
    then return jsonb_build_object('ok',false,'code','consent_required'); end if;
  select * into c from platform_member_credentials where member_id=m.id for update;
  if not found then return jsonb_build_object('ok',false,'code','credential_unavailable'); end if;
  if exists(select from admin_accounts where regexp_replace(phone,'[^0-9]','','g')=m.phone
      and (p_account_kind<>'admin' or id is distinct from p_existing_account_id))
    or exists(select from manager_accounts where regexp_replace(phone,'[^0-9]','','g')=m.phone
      and (p_account_kind<>'manager' or id is distinct from p_existing_account_id))
  then return jsonb_build_object('ok',false,'code','staff_phone_conflict'); end if;
  account_id:=coalesce(p_existing_account_id,gen_random_uuid());
  -- Bind first so the phone guard admits exactly this staff row.
  update platform_members set staff_account_kind=p_account_kind,staff_account_id=account_id where id=m.id;
  if p_existing_account_id is not null then
    if p_account_kind='admin' then
      update admin_accounts set password_hash=c.password_hash,password_salt=c.password_salt,password_set_at=c.password_set_at,
        failed_count=0,locked_until=null,reset_token_hash=null,reset_token_expires_at=null,reset_failed_count=0,updated_at=clock_timestamp()
        where id=account_id and active and regexp_replace(phone,'[^0-9]','','g')=m.phone;
    else
      update manager_accounts set password_hash=c.password_hash,password_salt=c.password_salt,password_set_at=c.password_set_at,
        failed_count=0,locked_until=null,reset_token_hash=null,reset_token_expires_at=null,reset_failed_count=0,updated_at=clock_timestamp()
        where id=account_id and active and regexp_replace(phone,'[^0-9]','','g')=m.phone;
    end if;
    found_account:=found;
    if not found_account then raise exception 'staff_account_unavailable'; end if;
  elsif p_account_kind='admin' then
    insert into admin_accounts(id,name,phone,staff_type,password_hash,password_salt,password_set_at,active)
      values(account_id,m.name,m.phone,p_staff_type,c.password_hash,c.password_salt,c.password_set_at,true);
    created:=true;
  else
    insert into manager_accounts(id,name,phone,password_hash,password_salt,password_set_at,active)
      values(account_id,m.name,m.phone,c.password_hash,c.password_salt,c.password_set_at,true);
    created:=true;
  end if;
  -- Earlier member-only tokens stop verifying; the next login yields the staff session.
  delete from platform_member_credentials where member_id=m.id;
  return jsonb_build_object('ok',true,'accountKind',p_account_kind,'accountId',account_id,'created',created,'alreadyGranted',false);
end $$;
revoke all on function public.grant_platform_staff_account_v1(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.grant_platform_staff_account_v1(uuid,text,text,uuid) to service_role;
