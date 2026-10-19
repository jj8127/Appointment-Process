-- A member may leave one service. Leaving 가람in (insurance) erases only what
-- 가람in collected plus the FC/가람링크 account; the 모두온 account, its login,
-- other service applications and service referrers stay. Leaving 모두온 still
-- removes every service. Settled business history keeps its anonymized UUIDs.
set local lock_timeout='3s';
set local statement_timeout='30s';

alter table public.platform_account_withdrawals
  add column scope text not null default 'all_affiliates' check (scope in ('all_affiliates','insurance'));
-- One 모두온 withdrawal per member; a member may leave 가람in again after re-registering.
alter table public.platform_account_withdrawals drop constraint platform_account_withdrawals_member_id_key;
create unique index platform_withdrawals_member_all on public.platform_account_withdrawals(member_id)
  where scope='all_affiliates';
create unique index platform_withdrawals_member_insurance_open on public.platform_account_withdrawals(member_id)
  where scope='insurance' and not completed;

-- Unlink 가람in from the common member. Enrollment moved the common password into
-- fc_credentials, so move a usable one back before the FC credential is removed.
create function public.detach_platform_member_insurance_v1(p_member_id uuid,p_fc_id uuid)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  insert into platform_member_credentials(member_id,password_hash,password_salt,session_version,failed_count,
    locked_until,password_set_at,updated_at)
    select p_member_id,c.password_hash,c.password_salt,coalesce(c.session_version,0)+1,0,null,c.password_set_at,clock_timestamp()
      from fc_credentials c where c.fc_id=p_fc_id and c.password_set_at is not null
        and c.password_hash is not null and c.password_salt is not null and not coalesce(c.must_change_password,false)
    on conflict(member_id) do nothing;
  update platform_members set fc_id=null,insurance_consent_version=null,insurance_consent_source=null,
    insurance_consent_recorded_at=null,insurance_enrollment_key=null,insurance_enrollment_fingerprint=null,
    insurance_enrollment_member_version=null,insurance_enrollment_fc_version=null
    where id=p_member_id and fc_id=p_fc_id;
end $$;
revoke all on function public.detach_platform_member_insurance_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.detach_platform_member_insurance_v1(uuid,uuid) to service_role;

create function public.begin_platform_insurance_withdrawal_v1(
  p_member_id uuid,p_operation_id uuid,p_session_digest text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; f fc_profiles; w platform_account_withdrawals; source_phone text; source_fc uuid;
begin
  if p_operation_id is null or p_member_id is null or p_session_digest is null
    or p_session_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,741014));
  select * into w from platform_account_withdrawals where operation_id=p_operation_id;
  if found then
    if w.member_id<>p_member_id or w.session_digest<>p_session_digest or w.scope<>'insurance' then raise exception 'forbidden'; end if;
    return to_jsonb(w);
  end if;
  select * into m from platform_members where id=p_member_id;
  if not found or not m.active or m.phone is null then raise exception 'member_unavailable'; end if;
  if m.fc_id is null or m.staff_account_id is not null then raise exception 'forbidden'; end if;
  source_phone:=m.phone; source_fc:=m.fc_id;
  -- Same lock order as insurance enrollment: phone domains, FC profile, member.
  perform pg_advisory_xact_lock(hashtextextended(source_phone,741012));
  perform pg_advisory_xact_lock(hashtextextended(source_phone,8102026));
  select * into f from fc_profiles where id=source_fc for update;
  if not found or f.phone<>source_phone or f.signup_completed is distinct from true
    or f.is_manager_referral_shadow or f.account_closed_at is not null then raise exception 'forbidden'; end if;
  select * into m from platform_members where id=p_member_id for update;
  if not m.active or m.phone is distinct from source_phone or m.fc_id is distinct from source_fc
    or m.staff_account_id is not null then raise exception 'forbidden'; end if;
  insert into platform_account_withdrawals(operation_id,member_id,session_digest,source_fc_id,scope)
    values(p_operation_id,m.id,p_session_digest,f.id,'insurance') returning * into w;
  perform set_config('moduon.withdrawal_operation_id',w.operation_id::text,true);
  update fc_profiles set account_closed_at=clock_timestamp(),signup_completed=false where id=f.id;
  perform set_config('moduon.withdrawal_operation_id','',true);
  perform detach_platform_member_insurance_v1(m.id,f.id);
  delete from fc_credentials where fc_id=f.id;
  delete from fc_signup_completion_challenges where fc_id=f.id;
  return to_jsonb(w);
end $$;
revoke all on function public.begin_platform_insurance_withdrawal_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.begin_platform_insurance_withdrawal_v1(uuid,uuid,text) to service_role;

-- The erase step closes the FC account for both scopes; only a 모두온 withdrawal
-- erases the common member.
create or replace function public.erase_platform_withdrawal_v1(
  p_operation_id uuid,p_session_digest text,p_affiliate_state text,p_preserved_company_role text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare w platform_account_withdrawals; receipt jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,741014));
  select * into w from platform_account_withdrawals
    where operation_id=p_operation_id and session_digest=p_session_digest;
  if not found then raise exception 'forbidden'; end if;
  if w.local_erased then return to_jsonb(w); end if;
  if w.source_fc_id is not null then
    if p_affiliate_state not in ('erased','company_account_preserved') or p_affiliate_state is null
      or (p_affiliate_state='company_account_preserved' and
        coalesce(p_preserved_company_role,'') not in ('admin','manager','designer','developer')) then raise exception 'affiliate_receipt_required'; end if;
    perform from fc_profiles where id=w.source_fc_id for update;
  elsif p_affiliate_state is distinct from 'not_applicable' then raise exception 'forbidden'; end if;
  perform from platform_members where id=w.member_id for update;
  if w.source_fc_id is not null then
    perform set_config('moduon.fc_closure_id',w.source_fc_id::text,true);
    receipt:=delete_account_core_transaction_v1('fc',w.source_fc_id);
    perform set_config('moduon.fc_closure_id','',true);
  end if;
  -- Reuse the existing erase-only function. It does not call the core delete
  -- transaction, so BEFORE DELETE projection triggers cannot recurse.
  if w.scope='all_affiliates' then perform delete_platform_member(w.member_id); end if;
  update platform_account_withdrawals set local_erased=true,cleanup_receipt=receipt,
    cleanup_outbox_id=(receipt->>'cleanup_outbox_id')::uuid,
    preserved_company_role=coalesce(p_preserved_company_role,preserved_company_role)
    where operation_id=w.operation_id returning * into w;
  return to_jsonb(w);
end $$;

-- 모두온 withdrawal removes every service: applications without a settlement are
-- deleted; settled ones keep only their anonymized UUID for settlement checks.
create or replace function public.delete_platform_member(p_member_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members;
begin
  select * into m from platform_members where id=p_member_id for update;
  if not found then raise exception 'member_unavailable'; end if;
  delete from platform_member_credentials where member_id=m.id;
  delete from platform_signup_challenges where phone=m.phone or consumed_member_id=m.id;
  delete from platform_service_applications a where a.member_id=m.id
    and not exists(select from platform_partner_settlements s where s.application_id=a.id);
  update platform_service_applications set details='{"region":"삭제","requestType":"삭제"}'::jsonb,
    status=case when status='interest' then 'cancelled' else status end where member_id=m.id;
  -- Erase live source bindings and direct identifying fields. Restricted source
  -- tombstones/cohort associations remain solely as no-auto-import/audit evidence.
  update platform_members set phone=null,name='탈퇴 회원',active=false,fc_id=null,
    staff_account_kind=null,staff_account_id=null,terms_accepted_at=null,terms_version=null,
    terms_basis=null,terms_recorded_at=null,insurance_consent_version=null,
    insurance_consent_source=null,insurance_consent_recorded_at=null,
    insurance_enrollment_key=null,insurance_enrollment_fingerprint=null,
    insurance_enrollment_member_version=null,insurance_enrollment_fc_version=null,
    withdrawal_source_kind=coalesce(withdrawal_source_kind,case when m.fc_id is not null then 'fc'
      when m.staff_account_id is not null then m.staff_account_kind else 'member' end),
    withdrawal_source_id=coalesce(withdrawal_source_id,m.fc_id,m.staff_account_id,m.id)
    where id=m.id;
  return jsonb_build_object('ok',true,'deleted',true);
end $$;

-- Deleting only the insurance account (FC hard delete) detaches it from the
-- common member instead of withdrawing the whole 모두온 account. Company staff
-- account deletion keeps its existing full erase.
create or replace function public.erase_platform_fc_identity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare mapped uuid;
begin
  if tg_table_name='fc_profiles' then
    select id into mapped from platform_members where fc_id=old.id for update;
    if mapped is not null then perform detach_platform_member_insurance_v1(mapped,old.id); end if;
  else
    select id into mapped from platform_members where
      staff_account_kind=case tg_table_name when 'admin_accounts' then 'admin' when 'manager_accounts' then 'manager' end
      and staff_account_id=old.id for update;
    if mapped is not null then perform delete_platform_member(mapped); end if;
    delete from platform_signup_challenges where phone=old.phone;
  end if;
  return old;
end $$;
