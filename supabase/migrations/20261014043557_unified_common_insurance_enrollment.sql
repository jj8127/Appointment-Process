-- One common login, with explicit insurance registration as a separate operation.
-- Import attestations are not fabricated user acceptance dates. Historical
-- anonymized withdrawals must be resolved before an automatic import is safe.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$ begin
  if exists(select from public.platform_members where not active and phone is null
    and fc_id is null and staff_account_id is null) then
    raise exception 'platform_withdrawal_provenance_required';
  end if;
end $$;

alter table public.platform_members
  add column terms_basis text check (terms_basis in ('user_acceptance','company_attested_import')),
  add column terms_recorded_at timestamptz,
  add column insurance_consent_version text,
  add column insurance_consent_source text check (insurance_consent_source in ('user_acceptance','company_attested_import')),
  add column insurance_consent_recorded_at timestamptz,
  add column insurance_enrollment_key uuid,
  add column insurance_enrollment_fingerprint text,
  add column insurance_enrollment_member_version bigint,
  add column insurance_enrollment_fc_version bigint,
  add column withdrawal_source_kind text check (withdrawal_source_kind in ('member','fc','admin','manager')),
  add column withdrawal_source_id uuid;

-- Existing genuine acceptance dates stay exactly as recorded.
update public.platform_members set terms_basis='user_acceptance',terms_recorded_at=terms_accepted_at
where terms_accepted_at is not null;

alter table public.fc_profiles drop constraint if exists fc_profiles_signup_verification_method_check;
alter table public.fc_profiles add constraint fc_profiles_signup_verification_method_check
  check (signup_verification_method is null or signup_verification_method in
    ('phone_otp','admin_written_consent','platform_member_session'));

-- Freeze the company-attested cohort at migration application. Source UUIDs,
-- rather than creation dates, prevent an old incomplete draft completed later
-- from acquiring the company's historical attestation.
create table public.platform_legacy_membership_cohort (
  account_kind text not null check (account_kind in ('fc','admin','manager')),
  account_id uuid not null,
  recorded_at timestamptz not null default clock_timestamp(),
  created_member_id uuid references public.platform_members(id) on delete restrict,
  primary key(account_kind,account_id)
);
alter table public.platform_legacy_membership_cohort enable row level security;
revoke all on public.platform_legacy_membership_cohort from public,anon,authenticated;
grant select on public.platform_legacy_membership_cohort to service_role;

insert into platform_legacy_membership_cohort(account_kind,account_id)
  select 'admin',id from admin_accounts where active and phone ~ '^[0-9]{11}$' and length(trim(name)) between 1 and 80
  union all select 'manager',id from manager_accounts where active and phone ~ '^[0-9]{11}$' and length(trim(name)) between 1 and 80
  union all select 'fc',f.id from fc_profiles f where f.signup_completed and not coalesce(f.is_manager_referral_shadow,false)
    and f.phone ~ '^[0-9]{11}$' and length(trim(f.name)) between 1 and 80
    and not exists(select from admin_accounts a where regexp_replace(a.phone,'[^0-9]','','g')=f.phone)
    and not exists(select from manager_accounts a where regexp_replace(a.phone,'[^0-9]','','g')=f.phone);

-- Create every new source member before resolving any referral. This includes
-- completed FCs awaiting initial password recovery, without granting a session.
with sources as (
  select c.account_kind,c.account_id,c.recorded_at,f.phone,f.name from platform_legacy_membership_cohort c
    join fc_profiles f on c.account_kind='fc' and c.account_id=f.id
  union all select c.account_kind,c.account_id,c.recorded_at,a.phone,a.name from platform_legacy_membership_cohort c
    join admin_accounts a on c.account_kind='admin' and c.account_id=a.id
  union all select c.account_kind,c.account_id,c.recorded_at,a.phone,a.name from platform_legacy_membership_cohort c
    join manager_accounts a on c.account_kind='manager' and c.account_id=a.id
), inserted as (
  insert into platform_members(phone,name,fc_id,staff_account_kind,staff_account_id,terms_version,terms_basis,terms_recorded_at,
    insurance_consent_version,insurance_consent_source,insurance_consent_recorded_at)
  select phone,name,case when account_kind='fc' then account_id end,
    case when account_kind<>'fc' then account_kind end,case when account_kind<>'fc' then account_id end,
    '2026-10-12','company_attested_import',recorded_at,'insurance-additional-info-v1','company_attested_import',recorded_at
    from sources order by account_kind,account_id on conflict(phone) do nothing
  returning id,fc_id,staff_account_kind,staff_account_id
)
update platform_legacy_membership_cohort c set created_member_id=i.id from inserted i
  where (c.account_kind='fc' and c.account_id=i.fc_id)
    or (c.account_kind=i.staff_account_kind and c.account_id=i.staff_account_id);

-- Preserve actual acceptance dates and any genuine chosen common referrer,
-- including NULL, on preexisting rows. Record the imported purpose separately.
update platform_members m set terms_version='2026-10-12',
  terms_basis=case when m.terms_version='2026-10-12' and m.terms_accepted_at is not null then 'user_acceptance' else 'company_attested_import' end,
  terms_recorded_at=coalesce(m.terms_recorded_at,c.recorded_at),
  insurance_consent_version=coalesce(m.insurance_consent_version,'insurance-additional-info-v1'),
  insurance_consent_source=coalesce(m.insurance_consent_source,'company_attested_import'),
  insurance_consent_recorded_at=coalesce(m.insurance_consent_recorded_at,c.recorded_at)
from platform_legacy_membership_cohort c where m.active and
  ((c.account_kind='fc' and c.account_id=m.fc_id) or (c.account_kind=m.staff_account_kind and c.account_id=m.staff_account_id));

update platform_members m set referrer_id=inviter.id
from platform_legacy_membership_cohort c join fc_profiles f on c.account_kind='fc' and c.account_id=f.id
  join fc_profiles recruiter on recruiter.id=f.recommender_fc_id
  join platform_members inviter on inviter.active and
    ((not coalesce(recruiter.is_manager_referral_shadow,false) and inviter.fc_id=recruiter.id)
      or (recruiter.is_manager_referral_shadow and inviter.staff_account_kind='manager' and exists(
        select from manager_accounts manager where manager.active and manager.id=inviter.staff_account_id
          and regexp_replace(manager.phone,'[^0-9]','','g')=recruiter.phone)))
where m.id=c.created_member_id and m.referrer_id is null and inviter.id<>m.id;

create or replace function public.import_platform_legacy_member_v1(
  p_phone text,p_account_kind text,p_account_id uuid
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; source_name text; source_fc uuid; cohort platform_legacy_membership_cohort;
begin
  if p_phone is null or p_phone !~ '^[0-9]{11}$' or p_account_id is null
    or p_account_kind is null or p_account_kind not in ('fc','admin','manager') then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  if exists(select from platform_members where not active and
    ((withdrawal_source_kind=p_account_kind and withdrawal_source_id=p_account_id)
      or (withdrawal_source_kind is null and phone is null and fc_id is null and staff_account_id is null))) then
    return jsonb_build_object('ok',false,'code','common_membership_withdrawn'); end if;
  select * into cohort from platform_legacy_membership_cohort where account_kind=p_account_kind and account_id=p_account_id;
  if not found then return jsonb_build_object('ok',false,'code','company_attestation_unavailable'); end if;
  if p_account_kind='fc' then
    select f.name,f.id into source_name,source_fc from fc_profiles f where f.id=p_account_id and f.phone=p_phone
      and f.signup_completed and not coalesce(f.is_manager_referral_shadow,false) for update;
    if source_fc is null or exists(select from admin_accounts where regexp_replace(phone,'[^0-9]','','g')=p_phone)
      or exists(select from manager_accounts where regexp_replace(phone,'[^0-9]','','g')=p_phone) then raise exception 'forbidden'; end if;
  elsif p_account_kind='admin' then
    select name into source_name from admin_accounts where id=p_account_id and phone=p_phone and active for update;
  else
    select name into source_name from manager_accounts where id=p_account_id and phone=p_phone and active for update;
  end if;
  if nullif(trim(source_name),'') is null then raise exception 'forbidden'; end if;
  select * into m from platform_members where phone=p_phone for update;
  if found then
    if not m.active or (m.fc_id is not null and m.fc_id is distinct from source_fc)
      or (m.staff_account_id is not null and (m.staff_account_kind is distinct from p_account_kind
        or m.staff_account_id is distinct from p_account_id)) then raise exception 'forbidden'; end if;
    update platform_members set name=source_name,fc_id=source_fc,
      staff_account_kind=case when source_fc is null then p_account_kind end,
      staff_account_id=case when source_fc is null then p_account_id end,
      terms_version='2026-10-12',terms_basis=case when terms_version='2026-10-12' and terms_accepted_at is not null
        then 'user_acceptance' else 'company_attested_import' end,
      terms_recorded_at=coalesce(terms_recorded_at,terms_accepted_at,cohort.recorded_at),
      insurance_consent_version=coalesce(insurance_consent_version,'insurance-additional-info-v1'),
      insurance_consent_source=coalesce(insurance_consent_source,'company_attested_import'),
      insurance_consent_recorded_at=coalesce(insurance_consent_recorded_at,cohort.recorded_at) where id=m.id;
  else
    -- A deleted or erased cohort source must never be silently recreated.
    return jsonb_build_object('ok',false,'code','common_membership_unavailable');
  end if;
  delete from platform_member_credentials where member_id=m.id;
  return jsonb_build_object('ok',true,'memberId',m.id);
end $$;
revoke all on function public.import_platform_legacy_member_v1(text,text,uuid) from public,anon,authenticated;
grant execute on function public.import_platform_legacy_member_v1(text,text,uuid) to service_role;

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

-- Keep the old explicit-consent RPC for old app installations. Fresh verified
-- user acceptance may create a new UUID after withdrawal. It never reactivates
-- the old row or clears its withdrawal/settlement/referral evidence. Automatic
-- company import remains blocked by the original-source withdrawal tombstone.
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
    perform from fc_profiles where id=p_fc_id and phone=p_phone and signup_completed and not coalesce(is_manager_referral_shadow,false) for update;
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
  if not m.active or (m.fc_id is not null and m.fc_id is distinct from p_fc_id)
    or (m.staff_account_id is not null and (m.staff_account_kind is distinct from p_account_kind
      or m.staff_account_id is distinct from p_account_id)) then raise exception 'forbidden'; end if;
  -- Explicit consent may follow a verified FC/staff role transition on the
  -- same phone. Keep the shared graph UUID, bind only the locked source above,
  -- and invalidate tokens backed by the previous canonical source.
  update platform_members set terms_accepted_at=coalesce(terms_accepted_at,clock_timestamp()),
    terms_version=p_terms_version,terms_basis='user_acceptance',terms_recorded_at=clock_timestamp(),name=trim(p_name),fc_id=p_fc_id,
    staff_account_kind=case when p_fc_id is null then p_account_kind end,
    staff_account_id=case when p_fc_id is null then p_account_id end where id=m.id;
  delete from platform_member_credentials where member_id=m.id;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.validate_platform_insurance_referral_v1(p_phone text,p_code text)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare inviter fc_profiles; code_row referral_codes;
begin
  if p_phone is null or p_phone !~ '^[0-9]{11}$' or length(trim(coalesce(p_code,''))) not between 1 and 64 then
    return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  select * into code_row from referral_codes where code=upper(trim(p_code)) and is_active;
  if not found then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  select * into inviter from fc_profiles where id=code_row.fc_id;
  if not found or inviter.phone=p_phone or position('설계매니저' in coalesce(inviter.affiliation,''))>0
    or not ((inviter.signup_completed and not coalesce(inviter.is_manager_referral_shadow,false))
      or (inviter.is_manager_referral_shadow and exists(
      select from manager_accounts a where a.active and regexp_replace(a.phone,'[^0-9]','','g')=inviter.phone))) then
    return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  return jsonb_build_object('ok',true,'inviterFcId',inviter.id,'inviterName',inviter.name,
    'inviterAffiliation',inviter.affiliation,'referralCode',code_row.code);
end $$;
revoke all on function public.validate_platform_insurance_referral_v1(text,text) from public,anon,authenticated;
grant execute on function public.validate_platform_insurance_referral_v1(text,text) to service_role;

create or replace function public.enroll_platform_insurance_v1(
  p_member_id uuid,p_phone text,p_member_session_version bigint,p_idempotency_key uuid,p_request_fingerprint text,
  p_consent_version text,p_affiliation text,p_email text,p_carrier text,p_license_statuses text[],
  p_referral_code text,p_referral_inviter_fc_id uuid
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; c platform_member_credentials; f fc_profiles; v bigint;
  referral jsonb; code_row referral_codes; checked_at timestamptz; normalized_statuses text[];
begin
  if p_member_id is null or p_phone is null or p_phone !~ '^[0-9]{11}$'
    or p_member_session_version is null or p_member_session_version<0 or p_idempotency_key is null
    or coalesce(p_request_fingerprint,'') !~ '^[a-f0-9]{64}$' then raise exception 'invalid_input'; end if;
  -- Shared phone locks serialize common signup, old FC signup and conversion.
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  perform pg_advisory_xact_lock(hashtextextended(p_phone,8102026));
  select * into m from platform_members where id=p_member_id and phone=p_phone for update;
  if not found or not m.active or m.staff_account_id is not null then raise exception 'forbidden'; end if;
  if m.fc_id is not null then
    select * into f from fc_profiles where id=m.fc_id and phone=p_phone for update;
    select session_version into v from fc_credentials where fc_id=m.fc_id and password_set_at is not null
      and not coalesce(must_change_password,false) for update;
    if f.id is null or not f.signup_completed or coalesce(f.is_manager_referral_shadow,false)
      or m.insurance_enrollment_key is distinct from p_idempotency_key
      or m.insurance_enrollment_fingerprint is distinct from p_request_fingerprint
      or m.insurance_enrollment_member_version is distinct from p_member_session_version
      or v is null or v is distinct from m.insurance_enrollment_fc_version then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('ok',true,'fcId',f.id,'sessionVersion',v,'alreadyApplied',true);
  end if;
  select * into c from platform_member_credentials where member_id=m.id for update;
  if not found or c.session_version is distinct from p_member_session_version then raise exception 'forbidden'; end if;
  if m.terms_version is distinct from '2026-10-12' or m.terms_accepted_at is null then raise exception 'consent_required'; end if;
  select array_agg(distinct trim(s)) into normalized_statuses from unnest(p_license_statuses) s;
  if p_consent_version is distinct from 'insurance-additional-info-v1'
    or length(trim(coalesce(p_affiliation,''))) not between 1 and 120
    or position('설계매니저' in coalesce(p_affiliation,''))>0
    or length(trim(coalesce(p_email,''))) not between 3 and 254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or p_carrier is null or p_carrier not in ('SKT','KT','LGU+','SKT 알뜰폰','KT 알뜰폰','LGU+ 알뜰폰')
    or coalesce(cardinality(normalized_statuses),0)=0
    or exists(select from unnest(normalized_statuses) s where s is null or s not in ('third','life','nonlife','none'))
    or ('none'=any(normalized_statuses) and cardinality(normalized_statuses)>1) then raise exception 'invalid_input'; end if;
  if exists(select from admin_accounts where regexp_replace(phone,'[^0-9]','','g')=p_phone)
    or exists(select from manager_accounts where regexp_replace(phone,'[^0-9]','','g')=p_phone) then raise exception 'forbidden'; end if;
  select * into f from fc_profiles where phone=p_phone for update;
  if found and (f.signup_completed or coalesce(f.is_manager_referral_shadow,false)
    or coalesce(f.status,'draft')<>'draft' or f.identity_completed or f.temp_id is not null
    or exists(select from fc_credentials where fc_id=f.id and password_set_at is not null)
    or exists(select from fc_identity_secure where fc_id=f.id)
    or exists(select from fc_documents where fc_id=f.id)) then raise exception 'forbidden'; end if;
  referral:=validate_platform_insurance_referral_v1(p_phone,p_referral_code);
  if coalesce((referral->>'ok')::boolean,false) is not true
    or (referral->>'inviterFcId')::uuid is distinct from p_referral_inviter_fc_id then raise exception 'invalid_referral'; end if;
  perform from fc_profiles where id=p_referral_inviter_fc_id for update;
  select * into code_row from referral_codes where code=upper(trim(p_referral_code))
    and fc_id=p_referral_inviter_fc_id and is_active for update;
  if not found then raise exception 'invalid_referral'; end if;
  checked_at:=clock_timestamp();
  if f.id is null then
    insert into fc_profiles(name,phone,affiliation,status,signup_completed)
      values(m.name,p_phone,trim(p_affiliation),'draft',false) returning * into f;
  end if;
  referral:=apply_referral_link_state(p_invitee_fc_id=>f.id,p_inviter_fc_id=>p_referral_inviter_fc_id,
    p_referral_code_id=>code_row.id,p_referral_code=>code_row.code,p_source=>'signup',
    p_actor_phone=>p_phone,p_actor_role=>'system',p_actor_staff_type=>null,p_reason=>'common_member_insurance_registration');
  if coalesce((referral->>'ok')::boolean,false) is not true then raise exception 'invalid_referral'; end if;
  insert into fc_credentials(fc_id,password_hash,password_salt,password_set_at,session_version,
    failed_count,locked_until,must_change_password,created_at,updated_at)
    values(f.id,c.password_hash,c.password_salt,c.password_set_at,c.session_version,
      c.failed_count,c.locked_until,false,checked_at,checked_at)
    on conflict(fc_id) do update set password_hash=excluded.password_hash,password_salt=excluded.password_salt,
      password_set_at=excluded.password_set_at,failed_count=excluded.failed_count,locked_until=excluded.locked_until,
      must_change_password=false,reset_token_hash=null,reset_token_expires_at=null,reset_sent_at=null,
      reset_failed_count=0,updated_at=excluded.updated_at returning session_version into v;
  update platform_members set fc_id=f.id,insurance_consent_version=p_consent_version,
    insurance_consent_source='user_acceptance',insurance_consent_recorded_at=checked_at,
    insurance_enrollment_key=p_idempotency_key,insurance_enrollment_fingerprint=p_request_fingerprint,
    insurance_enrollment_member_version=p_member_session_version,insurance_enrollment_fc_version=v where id=m.id;
  update fc_profiles set name=m.name,affiliation=trim(p_affiliation),email=lower(trim(p_email)),carrier=p_carrier,
    license_statuses=normalized_statuses,status='draft',life_commission_completed=false,nonlife_commission_completed=false,
    signup_completed=true,signup_verification_method='platform_member_session',signup_verified_at=checked_at,
    signup_verified_by_admin_id=null,phone_verification_hash=null,phone_verification_expires_at=null,updated_at=checked_at
    where id=f.id;
  -- Projection removes the common credential only after its compatible hash
  -- and salt have committed to the canonical FC account in this transaction.
  delete from platform_member_credentials where member_id=m.id;
  return jsonb_build_object('ok',true,'fcId',f.id,'sessionVersion',v,'alreadyApplied',false);
end $$;
revoke all on function public.enroll_platform_insurance_v1(uuid,text,bigint,uuid,text,text,text,text,text,text[],text,uuid)
  from public,anon,authenticated;
grant execute on function public.enroll_platform_insurance_v1(uuid,text,bigint,uuid,text,text,text,text,text,text[],text,uuid) to service_role;

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
      or profile_row.signup_completed is distinct from true
      or coalesce(profile_row.is_manager_referral_shadow,false) then
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
  -- A completed ordinary FC may set its missing initial password through
  -- the existing bounded reset proof. The placeholder itself cannot log in.
  if p_account_kind='fc' and (account_row is null or account_row->>'password_set_at' is null) then
    if position('설계매니저' in coalesce(profile_row.affiliation,''))>0
      or exists(select from public.admin_accounts where regexp_replace(phone,'[^0-9]','','g')=p_phone)
      or exists(select from public.manager_accounts where regexp_replace(phone,'[^0-9]','','g')=p_phone) then
      return jsonb_build_object('ok',false,'code','account_unavailable'); end if;
    if account_row is null and p_action='issue' then
      insert into public.fc_credentials(fc_id,password_hash,password_salt,password_set_at)
        values(p_account_id,'','',null) on conflict(fc_id) do nothing;
      select to_jsonb(c) into account_row from public.fc_credentials c where fc_id=p_account_id for update;
    end if;
  end if;
  if account_row is null
    or (p_account_kind<>'fc' and account_row->>'password_set_at' is null)
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

-- Common referral signup accepts attested imports without inventing a user
-- Old installations retain their OTP signup protocol for nonmembers. Once
-- common signup wins the shared phone lock, the old protocol cannot replace
-- that canonical credential or bypass explicit service registration.
create or replace function public.issue_fc_signup_otp_v1(
  p_phone text,
  p_code_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  profile_row public.fc_profiles%rowtype;
  credential_row public.fc_credentials%rowtype;
  profile_exists boolean := false;
  credential_exists boolean := false;
  should_reset boolean := false;
  checked_at timestamptz;
  delivery_id uuid;
  auth_profile_ids jsonb := '[]'::jsonb;
begin
  if normalized_phone !~ '^01[0-9]{9}$'
    or coalesce(p_code_hash, '') !~ '^[A-Za-z0-9+/]{43}=$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  -- verify_fc_signup_otp_v1 and complete_fc_otp_signup_v1 use this exact
  -- namespace. Issuance must participate in the same per-phone lifecycle.
  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 8102026));
  if exists(select from public.platform_members where phone=normalized_phone and active) then
    return jsonb_build_object('ok',false,'code','already_exists'); end if;


  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.phone = normalized_phone
  for update;
  profile_exists := found;

  if profile_exists then
    select credential.*
      into credential_row
    from public.fc_credentials credential
    where credential.fc_id = profile_row.id
    for update;
    credential_exists := found;

    if profile_row.is_manager_referral_shadow is true
      or (
        profile_row.signup_completed is true
        and credential_exists
        and credential_row.password_set_at is not null
      ) then
      return jsonb_build_object('ok', false, 'code', 'already_exists');
    end if;
  end if;

  perform 1
  from public.admin_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  perform 1
  from public.manager_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  -- Evaluate lock and cooldown after every lock wait, never from an Edge
  -- timestamp captured before the critical section.
  checked_at := clock_timestamp();

  if profile_exists
    and profile_row.phone_verification_locked_until is not null
    and profile_row.phone_verification_locked_until > checked_at then
    return jsonb_build_object('ok', false, 'code', 'locked');
  end if;

  if profile_exists
    and profile_row.phone_verification_sent_at is not null
    and profile_row.phone_verification_sent_at > checked_at - interval '60 seconds' then
    return jsonb_build_object('ok', false, 'code', 'cooldown');
  end if;

  insert into public.platform_sms_delivery_attempts(purpose)
    values('fc_signup')
    returning id into delivery_id;

  if not profile_exists then
    insert into public.fc_profiles (
      phone,
      name,
      affiliation,
      recommender,
      recommender_fc_id,
      recommender_code_id,
      recommender_code,
      recommender_linked_at,
      recommender_link_source,
      email,
      address,
      status,
      identity_completed,
      signup_completed,
      phone_verified,
      phone_verified_at,
      phone_verification_hash,
      phone_verification_expires_at,
      phone_verification_sent_at,
      phone_verification_attempts,
      phone_verification_locked_until,
      phone_verification_delivery_id,
      signup_verification_method,
      signup_verified_at,
      signup_verified_by_admin_id,
      updated_at
    ) values (
      normalized_phone,
      '',
      '',
      '',
      null,
      null,
      null,
      null,
      null,
      '',
      '',
      'draft',
      false,
      false,
      false,
      null,
      p_code_hash,
      checked_at + interval '5 minutes',
      checked_at,
      0,
      null,
      delivery_id,
      null,
      null,
      null,
      checked_at
    )
    returning * into profile_row;
  else
    should_reset := profile_row.phone_verified is true
      or profile_row.signup_completed is true
      or profile_row.status is distinct from 'draft'
      or profile_row.identity_completed is true
      or credential_exists
      or exists (
        select 1 from public.profiles auth_profile
        where auth_profile.fc_id = profile_row.id
      );

    if should_reset then
      delete from public.fc_identity_secure secure
      where secure.fc_id = profile_row.id;

      delete from public.fc_credentials credential
      where credential.fc_id = profile_row.id;

      with deleted_auth_profile as (
        delete from public.profiles auth_profile
        where auth_profile.fc_id = profile_row.id
        returning auth_profile.id
      )
      select coalesce(jsonb_agg(id order by id), '[]'::jsonb)
        into auth_profile_ids
      from deleted_auth_profile;

      update public.fc_profiles
      set phone_verification_hash = p_code_hash,
          phone_verification_expires_at = checked_at + interval '5 minutes',
          phone_verification_sent_at = checked_at,
          phone_verification_attempts = 0,
          phone_verification_locked_until = null,
          phone_verification_delivery_id = delivery_id,
          name = '',
          affiliation = '',
          recommender = '',
          recommender_fc_id = null,
          recommender_code_id = null,
          recommender_code = null,
          recommender_linked_at = null,
          recommender_link_source = null,
          email = '',
          address = '',
          address_detail = null,
          resident_id_masked = null,
          resident_id_hash = null,
          identity_completed = false,
          status = 'draft',
          life_commission_completed = false,
          nonlife_commission_completed = false,
          temp_id = null,
          allowance_date = null,
          allowance_prescreen_requested_at = null,
          allowance_reject_reason = null,
          appointment_url = null,
          appointment_date = null,
          appointment_schedule_life = null,
          appointment_schedule_nonlife = null,
          appointment_date_life = null,
          appointment_date_nonlife = null,
          appointment_date_life_sub = null,
          appointment_date_nonlife_sub = null,
          appointment_reject_reason_life = null,
          appointment_reject_reason_nonlife = null,
          docs_deadline_at = null,
          docs_deadline_last_notified_at = null,
          hanwha_commission_date_sub = null,
          hanwha_commission_date = null,
          hanwha_commission_reject_reason = null,
          hanwha_commission_pdf_path = null,
          hanwha_commission_pdf_name = null,
          dawichok_url_sent_at = null,
          dawichok_url_sent_by = null,
          signup_completed = false,
          phone_verified = false,
          phone_verified_at = null,
          signup_verification_method = null,
          signup_verified_at = null,
          signup_verified_by_admin_id = null,
          updated_at = checked_at
      where id = profile_row.id;
    else
      update public.fc_profiles
      set phone_verification_hash = p_code_hash,
          phone_verification_expires_at = checked_at + interval '5 minutes',
          phone_verification_sent_at = checked_at,
          phone_verification_attempts = 0,
          phone_verification_locked_until = null,
          phone_verification_delivery_id = delivery_id,
          updated_at = checked_at
      where id = profile_row.id;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'deliveryId', delivery_id,
    'authProfileIds', auth_profile_ids,
    'resetApplied', should_reset
  );
end;
$$;

create or replace function public.complete_fc_otp_signup_v1(
  p_phone text,
  p_completion_token_hash text,
  p_request_fingerprint text,
  p_name text,
  p_affiliation text,
  p_email text,
  p_carrier text,
  p_license_statuses text[],
  p_referral_code text,
  p_referral_inviter_fc_id uuid,
  p_password_hash text,
  p_password_salt text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  profile_row public.fc_profiles%rowtype;
  credential_row public.fc_credentials%rowtype;
  proof_row public.fc_signup_completion_challenges%rowtype;
  inviter_row public.fc_profiles%rowtype;
  referral_code_row public.referral_codes%rowtype;
  referral_result jsonb;
  stored_result jsonb;
  credential_session_version bigint;
  normalized_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  normalized_name text := trim(coalesce(p_name, ''));
  normalized_affiliation text := trim(coalesce(p_affiliation, ''));
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_carrier text := trim(coalesce(p_carrier, ''));
  normalized_referral_code text := upper(trim(coalesce(p_referral_code, '')));
  normalized_license_statuses text[];
  checked_at timestamptz;
  next_status text;
  next_life_completed boolean;
  next_nonlife_completed boolean;
begin
  select coalesce(array_agg(distinct status_value order by status_value), array[]::text[])
    into normalized_license_statuses
  from unnest(coalesce(p_license_statuses, array[]::text[])) status_value;

  if normalized_phone !~ '^01[0-9]{9}$'
    or coalesce(p_completion_token_hash, '') !~ '^[a-f0-9]{64}$'
    or coalesce(p_request_fingerprint, '') !~ '^[a-f0-9]{64}$'
    or char_length(normalized_name) not between 2 and 40
    or char_length(normalized_affiliation) not between 2 and 80
    or normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or normalized_carrier not in (
      'SKT', 'KT', 'LGU+', 'SKT 알뜰폰', 'KT 알뜰폰', 'LGU+ 알뜰폰'
    )
    or cardinality(normalized_license_statuses) = 0
    or exists (
      select 1
      from unnest(normalized_license_statuses) status_value
      where status_value is null
        or status_value not in ('third', 'life', 'nonlife', 'none')
    )
    or (
      'none' = any(normalized_license_statuses)
      and cardinality(normalized_license_statuses) > 1
    )
    or normalized_referral_code = ''
    or char_length(normalized_referral_code) > 64
    or p_referral_inviter_fc_id is null
    or coalesce(p_password_hash, '') !~ '^[A-Za-z0-9+/]{43}=$'
    or coalesce(p_password_salt, '') !~ '^[A-Za-z0-9+/]{22}==$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(normalized_phone, 8102026));
  if exists(select from public.platform_members where phone=normalized_phone and active and fc_id is null and staff_account_id is null) then
    return jsonb_build_object('ok',false,'code','already_exists'); end if;


  select profile.*
    into profile_row
  from public.fc_profiles profile
  where profile.phone = normalized_phone
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select challenge.*
    into proof_row
  from public.fc_signup_completion_challenges challenge
  where challenge.fc_id = profile_row.id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'proof_required');
  end if;

  checked_at := clock_timestamp();

  if proof_row.token_hash is distinct from p_completion_token_hash then
    return jsonb_build_object('ok', false, 'code', 'proof_invalid');
  end if;

  if proof_row.expires_at <= checked_at then
    return jsonb_build_object('ok', false, 'code', 'proof_expired');
  end if;

  if proof_row.consumed_at is not null then
    if proof_row.request_fingerprint is not distinct from p_request_fingerprint
      and proof_row.result is not null then
      return jsonb_set(proof_row.result, '{alreadyApplied}', 'true'::jsonb, true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'request_conflict');
  end if;

  -- phone_verified without the matching, live proof above is never authority.
  if profile_row.phone_verified is distinct from true
    or profile_row.signup_verification_method is distinct from 'phone_otp'
    or profile_row.phone_verified_at is null
    or profile_row.signup_verified_at is null then
    return jsonb_build_object('ok', false, 'code', 'proof_required');
  end if;

  if profile_row.signup_completed is true
    or profile_row.is_manager_referral_shadow is true then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  perform 1
  from public.admin_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  perform 1
  from public.manager_accounts account
  where regexp_replace(coalesce(account.phone, ''), '[^0-9]', '', 'g') = normalized_phone
  for share;
  if found then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  select credential.*
    into credential_row
  from public.fc_credentials credential
  where credential.fc_id = profile_row.id
  for update;

  if found and credential_row.password_set_at is not null then
    return jsonb_build_object('ok', false, 'code', 'already_exists');
  end if;

  if p_referral_inviter_fc_id = profile_row.id then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end if;

  select inviter.*
    into inviter_row
  from public.fc_profiles inviter
  where inviter.id = p_referral_inviter_fc_id
  for update;

  if not found
    or (
      inviter_row.signup_completed is distinct from true
      and inviter_row.is_manager_referral_shadow is distinct from true
    ) then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end if;

  select referral_code.*
    into referral_code_row
  from public.referral_codes referral_code
  where referral_code.code = normalized_referral_code
    and referral_code.fc_id = p_referral_inviter_fc_id
    and referral_code.is_active is true
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end if;

  -- Keep the current onboarding gate: license selections do not bypass the
  -- workflow. The database, rather than the client, derives all three fields.
  next_status := 'draft';
  next_life_completed := false;
  next_nonlife_completed := false;

  -- apply_referral_link_state is authoritative for inviter eligibility and
  -- graph invariants. Its writes run in a subtransaction so a failure cannot
  -- leave a partial referral mutation or consume the completion proof.
  begin
    referral_result := public.apply_referral_link_state(
      p_invitee_fc_id => profile_row.id,
      p_inviter_fc_id => p_referral_inviter_fc_id,
      p_referral_code_id => referral_code_row.id,
      p_referral_code => referral_code_row.code,
      p_source => 'signup',
      p_actor_phone => normalized_phone,
      p_actor_role => 'system',
      p_actor_staff_type => null,
      p_reason => 'complete_fc_otp_signup_v1'
    );

    if coalesce((referral_result ->> 'ok')::boolean, false) is not true then
      raise exception 'fc_signup_referral_failed';
    end if;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'referral_invalid');
  end;

  update public.fc_profiles
  set name = normalized_name,
      affiliation = normalized_affiliation,
      email = normalized_email,
      carrier = normalized_carrier,
      license_statuses = normalized_license_statuses,
      status = next_status,
      life_commission_completed = next_life_completed,
      nonlife_commission_completed = next_nonlife_completed,
      address = '',
      address_detail = null,
      resident_id_masked = null,
      resident_id_hash = null,
      identity_completed = false,
      temp_id = null,
      allowance_date = null,
      allowance_prescreen_requested_at = null,
      allowance_reject_reason = null,
      docs_deadline_at = null,
      docs_deadline_last_notified_at = null,
      appointment_url = null,
      appointment_date = null,
      appointment_schedule_life = null,
      appointment_schedule_nonlife = null,
      appointment_date_life = null,
      appointment_date_nonlife = null,
      appointment_date_life_sub = null,
      appointment_date_nonlife_sub = null,
      appointment_reject_reason_life = null,
      appointment_reject_reason_nonlife = null,
      hanwha_commission_date_sub = null,
      hanwha_commission_date = null,
      hanwha_commission_reject_reason = null,
      hanwha_commission_pdf_path = null,
      hanwha_commission_pdf_name = null,
      dawichok_url_sent_at = null,
      dawichok_url_sent_by = null,
      signup_completed = true,
      signup_verification_method = 'phone_otp',
      signup_verified_by_admin_id = null,
      updated_at = checked_at
  where id = profile_row.id;

  insert into public.fc_credentials (
    fc_id,
    password_hash,
    password_salt,
    password_set_at,
    failed_count,
    locked_until,
    reset_token_hash,
    reset_token_expires_at,
    reset_sent_at,
    reset_failed_count,
    must_change_password,
    temporary_password_issued_at,
    created_at,
    updated_at
  ) values (
    profile_row.id,
    p_password_hash,
    p_password_salt,
    checked_at,
    0,
    null,
    null,
    null,
    null,
    0,
    false,
    null,
    checked_at,
    checked_at
  )
  on conflict (fc_id) do update
  set password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      password_set_at = excluded.password_set_at,
      failed_count = 0,
      locked_until = null,
      reset_token_hash = null,
      reset_token_expires_at = null,
      reset_sent_at = null,
      reset_failed_count = 0,
      must_change_password = false,
      temporary_password_issued_at = null,
      updated_at = excluded.updated_at
  returning session_version into credential_session_version;

  stored_result := jsonb_build_object(
    'ok', true,
    'fcId', profile_row.id,
    'residentId', normalized_phone,
    'displayName', normalized_name,
    'affiliation', normalized_affiliation,
    'sessionVersion', credential_session_version,
    'alreadyApplied', false
  );

  update public.fc_signup_completion_challenges
  set consumed_at = checked_at,
      request_fingerprint = p_request_fingerprint,
      result = stored_result,
      updated_at = checked_at
  where fc_id = profile_row.id
    and token_hash = p_completion_token_hash
    and consumed_at is null;

  if not found then
    raise exception 'fc_signup_completion_proof_lost';
  end if;

  return stored_result;
end;
$$;


-- Common referral signup accepts attested imports without inventing a user
-- terms acceptance timestamp. All existing OTP and retry boundaries stay.
create or replace function public.register_platform_member(p_phone text,p_code_hash text,p_name text,
  p_password_hash text,p_password_salt text,p_referral_code text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c platform_signup_challenges; m platform_members; inviter uuid; checked_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  perform pg_advisory_xact_lock(hashtextextended(p_phone,8102026));
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
    select id into inviter from platform_members where referral_code=upper(trim(p_referral_code)) and active and (terms_accepted_at is not null or terms_basis='company_attested_import');
    if inviter is null then
      select m2.id into inviter from referral_codes r join platform_members m2 on m2.fc_id=r.fc_id
      where r.code=upper(trim(p_referral_code)) and r.is_active and m2.active and (m2.terms_accepted_at is not null or m2.terms_basis='company_attested_import');
    end if;
    if inviter is null then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  end if;
  insert into platform_members(phone,name,referrer_id,terms_accepted_at,terms_version)
    values(p_phone,trim(p_name),inviter,checked_at,'2026-10-12') returning * into m;
  insert into platform_member_credentials(member_id,password_hash,password_salt) values(m.id,p_password_hash,p_password_salt);
  update platform_signup_challenges set consumed_member_id=m.id where phone=p_phone;
  return jsonb_build_object('ok',true,'memberId',m.id,'displayName',m.name,'sessionVersion',0);
end $$;
