-- Custom signed sessions terminate at platform-service. No direct client access.
create table public.platform_members (
  id uuid primary key default gen_random_uuid(),
  phone text unique check (phone ~ '^[0-9]{11}$'),
  name text not null check (length(name) between 1 and 80),
  fc_id uuid unique references public.fc_profiles(id) on delete set null,
  referral_code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
  referrer_id uuid references public.platform_members(id) on delete restrict,
  active boolean not null default true,
  terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (referrer_id is distinct from id)
);
create index platform_members_referrer on public.platform_members(referrer_id);
create or replace function public.guard_platform_referrer() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.referrer_id is not null and new.referrer_id is distinct from old.referrer_id then
    perform pg_advisory_xact_lock(741011);
    if exists(with recursive ancestors(id,path) as (
      select new.referrer_id,array[new.referrer_id]
      union all select m.referrer_id,a.path||m.referrer_id from platform_members m join ancestors a on m.id=a.id
      where m.referrer_id is not null and not m.referrer_id=any(a.path)
    ) select from ancestors where id=new.id) then raise exception 'referral_cycle'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_platform_referrer() from public,anon,authenticated;
create trigger platform_referrer_cycle before update of referrer_id on public.platform_members
for each row execute function public.guard_platform_referrer();
create table public.platform_member_credentials (
  member_id uuid primary key references public.platform_members(id) on delete cascade,
  password_hash text not null,
  password_salt text not null,
  session_version bigint not null default 0,
  failed_count integer not null default 0,
  locked_until timestamptz
);
create table public.platform_signup_challenges (
  phone text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  attempts integer not null default 0,
  locked_until timestamptz
);
create trigger platform_credential_generation before update on public.platform_member_credentials
for each row execute function public.advance_credential_session_version();
create table public.platform_partners (
  id uuid primary key default gen_random_uuid(),
  service_key text not null check (service_key in ('insurance','care','telecom','rental','car','hospital')),
  name text not null check (length(name) between 1 and 100),
  region text not null check (length(region) between 1 and 50),
  address text not null default '',
  website_url text not null default '',
  phone text not null default '',
  active boolean not null default false,
  consumer_rate numeric(7,6) not null default 0 check (consumer_rate between 0 and 1),
  referrer_rate numeric(7,6) not null default 0 check (referrer_rate between 0 and 1),
  referrer_basis text not null default 'after_consumer' check (referrer_basis in ('commission','after_consumer')),
  ad_period_start date,
  ad_period_end date,
  ad_placement text,
  ad_fee bigint check (ad_fee >= 0),
  updated_at timestamptz not null default now(),
  revision bigint not null default 0 check (revision>=0),
  last_request jsonb,
  check (referrer_basis='after_consumer' or consumer_rate + referrer_rate <= 1),
  check (service_key not in ('hospital','insurance') or (consumer_rate=0 and referrer_rate=0)),
  check (ad_period_end is null or ad_period_start <= ad_period_end),
  check (service_key <> 'hospital' or not active or
    (ad_period_start is not null and ad_period_end is not null and ad_placement is not null and length(trim(ad_placement))>0 and ad_fee is not null))
);
create table public.platform_service_applications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.platform_members(id),
  service_key text not null check (service_key in ('insurance','care','telecom','rental','car')),
  details jsonb not null check (jsonb_typeof(details)='object'),
  referrer_id_snapshot uuid references public.platform_members(id),
  idempotency_key uuid not null,
  status text not null default 'interest' check (status in ('interest','settled','cancelled')),
  created_at timestamptz not null default now(),
  unique(member_id,idempotency_key)
);
create index platform_applications_owner_created on public.platform_service_applications(member_id,created_at desc);
create table public.platform_partner_settlements (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null unique references public.platform_service_applications(id),
  partner_id uuid not null references public.platform_partners(id),
  commission_amount bigint not null check (commission_amount >= 0),
  consumer_rate_snapshot numeric(7,6) not null,
  referrer_rate_snapshot numeric(7,6) not null,
  referrer_basis_snapshot text not null,
  referrer_id_snapshot uuid references public.platform_members(id),
  transaction_reference text not null check (length(transaction_reference) between 1 and 120),
  evidence_reference text not null check (length(evidence_reference) between 1 and 200),
  settled_at timestamptz not null,
  due_at timestamptz not null,
  idempotency_key uuid not null unique,
  recorded_by uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  check (due_at=settled_at+interval '7 days')
);
create table public.platform_member_benefits (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.platform_partner_settlements(id),
  member_id uuid not null references public.platform_members(id),
  service_key text not null,
  kind text not null check (kind in ('consumer','direct_referrer')),
  amount bigint not null check (amount>=0),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','paid')),
  paid_at timestamptz,
  transfer_reference text,
  unique(settlement_id,kind),
  check ((status='pending' and paid_at is null and transfer_reference is null) or
    (status='paid' and paid_at is not null and transfer_reference is not null and length(trim(transfer_reference)) between 1 and 120))
);
create index platform_benefits_owner_due on public.platform_member_benefits(member_id,due_at);

-- Existing FC information is projected only after explicit common-service
-- consent. Reading/logging in never enrolls an insurance account.

create or replace function public.sync_platform_fc_member() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare mapped uuid;
begin
  if new.signup_completed=true and new.phone ~ '^[0-9]{11}$' then
    select id into mapped from platform_members where fc_id=new.id for update;
    if mapped is not null then
      update platform_members set phone=new.phone,name=coalesce(nullif(new.name,''),'회원') where id=mapped;
    else
      -- A consumer may later complete FC enrollment. Reuse that already
      -- consented identity; never manufacture a new common-service member.
      update platform_members set name=coalesce(nullif(new.name,''),'회원'),fc_id=new.id
      where phone=new.phone and active and terms_accepted_at is not null and fc_id is null;
    end if;
    -- Completed FC credentials become the only password authority. Revoking
    -- the consumer credential invalidates earlier member-only tokens.
    delete from platform_member_credentials where member_id=(select id from platform_members where fc_id=new.id);
  end if;
  return new;
end $$;
revoke all on function public.sync_platform_fc_member() from public,anon,authenticated;
create trigger platform_fc_projection after insert or update of phone,name,signup_completed,recommender_fc_id
on public.fc_profiles for each row execute function public.sync_platform_fc_member();

create or replace function public.erase_platform_fc_identity() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  delete from platform_member_credentials where member_id=(select id from platform_members where fc_id=old.id);
  update platform_service_applications set details='{"region":"삭제","requestType":"삭제"}'::jsonb,
    status=case when status='interest' then 'cancelled' else status end
    where member_id=(select id from platform_members where fc_id=old.id);
  update platform_members set phone=null,name='탈퇴 회원',active=false where fc_id=old.id;
  return old;
end $$;
revoke all on function public.erase_platform_fc_identity() from public,anon,authenticated;
create trigger platform_fc_delete_identity before delete on public.fc_profiles
for each row execute function public.erase_platform_fc_identity();

create or replace function public.issue_platform_signup_otp(p_phone text,p_code_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c platform_signup_challenges; issued boolean;
begin
  if p_phone is null or p_phone !~ '^[0-9]{11}$' or p_code_hash is null or length(p_code_hash)<>44 then raise exception 'invalid_input'; end if;
  if exists(select from platform_members where phone=p_phone) or
     exists(select from admin_accounts where phone=p_phone) or
     exists(select from manager_accounts where phone=p_phone) or
     exists(select from fc_profiles where phone=p_phone and signup_completed=true)
  then return jsonb_build_object('ok',false,'code','already_exists'); end if;
  insert into platform_signup_challenges(phone,code_hash,expires_at,sent_at)
  values(p_phone,p_code_hash,now()+interval '5 minutes',now()) on conflict do nothing returning true into issued;
  select * into c from platform_signup_challenges where phone=p_phone for update;
  if c.locked_until>now() then return jsonb_build_object('ok',false,'code','locked'); end if;
  if issued is distinct from true and c.sent_at>now()-interval '60 seconds' then return jsonb_build_object('ok',false,'code','cooldown'); end if;
  update platform_signup_challenges set code_hash=p_code_hash,expires_at=now()+interval '5 minutes',sent_at=now(),attempts=0
  where phone=p_phone;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.register_platform_member(p_phone text,p_code_hash text,p_name text,
  p_password_hash text,p_password_salt text,p_referral_code text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c platform_signup_challenges; m platform_members; inviter uuid;
begin
  select * into c from platform_signup_challenges where phone=p_phone for update;
  if not found or c.expires_at<=now() then return jsonb_build_object('ok',false,'code','expired_code'); end if;
  if c.locked_until>now() then return jsonb_build_object('ok',false,'code','locked'); end if;
  if c.code_hash is distinct from p_code_hash then
    update platform_signup_challenges set attempts=attempts+1,
      locked_until=case when attempts>=4 then now()+interval '10 minutes' else null end where phone=p_phone;
    return jsonb_build_object('ok',false,'code','invalid_code');
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 or p_password_hash is null or p_password_salt is null
    or length(p_password_hash)<>44 or length(p_password_salt)<>24 then raise exception 'invalid_input'; end if;
  if exists(select from fc_profiles where phone=p_phone and signup_completed=true) or
    exists(select from admin_accounts where phone=p_phone) or exists(select from manager_accounts where phone=p_phone)
  then return jsonb_build_object('ok',false,'code','already_exists'); end if;
  if nullif(trim(p_referral_code),'') is not null then
    select id into inviter from platform_members where referral_code=upper(trim(p_referral_code)) and active;
    -- Older FC invitation codes resolve to the very same member projection.
    if inviter is null then
      select m2.id into inviter from referral_codes r join platform_members m2 on m2.fc_id=r.fc_id
      where r.code=upper(trim(p_referral_code)) and r.is_active=true and m2.active;
    end if;
    if inviter is null then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  end if;
  insert into platform_members(phone,name,referrer_id,terms_accepted_at)
  values(p_phone,trim(p_name),inviter,now()) returning * into m;
  insert into platform_member_credentials(member_id,password_hash,password_salt) values(m.id,p_password_hash,p_password_salt);
  delete from platform_signup_challenges where phone=p_phone;
  return jsonb_build_object('ok',true,'memberId',m.id,'displayName',m.name);
end $$;

create or replace function public.platform_login_attempt(p_member_id uuid,p_password_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c platform_member_credentials;
begin
  select * into c from platform_member_credentials where member_id=p_member_id for update;
  if not found or not exists(select from platform_members where id=p_member_id and active) then return jsonb_build_object('ok',false,'code','invalid_password'); end if;
  if c.locked_until>now() then return jsonb_build_object('ok',false,'code','locked'); end if;
  if c.password_hash is distinct from p_password_hash then
    update platform_member_credentials set failed_count=failed_count+1,
      locked_until=case when failed_count>=4 then now()+interval '10 minutes' else null end where member_id=p_member_id;
    return jsonb_build_object('ok',false,'code','invalid_password');
  end if;
  update platform_member_credentials set failed_count=0,locked_until=null where member_id=p_member_id;
  return jsonb_build_object('ok',true,'sessionVersion',c.session_version);
end $$;

create or replace function public.create_platform_application(p_member_id uuid,p_service_key text,p_details jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a platform_service_applications; m platform_members;
begin
  select * into m from platform_members where id=p_member_id and active for update;
  if not found then raise exception 'member_unavailable'; end if;
  if p_service_key is null or p_service_key not in ('insurance','care','telecom','rental','car') or jsonb_typeof(p_details) is distinct from 'object'
    or (p_details-'region'-'requestType')<>'{}'::jsonb
    or jsonb_typeof(p_details->'region') is distinct from 'string' or jsonb_typeof(p_details->'requestType') is distinct from 'string'
    or length(p_details->>'region') not between 1 and 50 or length(p_details->>'requestType') not between 1 and 100
  then raise exception 'invalid_details'; end if;
  insert into platform_service_applications(member_id,service_key,details,referrer_id_snapshot,idempotency_key)
  values(m.id,p_service_key,p_details,m.referrer_id,p_idempotency_key) on conflict(member_id,idempotency_key) do nothing;
  select * into a from platform_service_applications where member_id=m.id and idempotency_key=p_idempotency_key;
  if a.service_key<>p_service_key or a.details<>p_details then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('ok',true,'applicationId',a.id,'status',a.status);
end $$;

create or replace function public.save_platform_partner(p_admin_id uuid,p_partner jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare existing platform_partners; saved platform_partners; partner_id uuid;
begin
  if not exists(select from admin_accounts where id=p_admin_id and active and staff_type='admin') then raise exception 'forbidden'; end if;
  if p_expected_revision is null or p_expected_revision<0 or jsonb_typeof(p_partner) is distinct from 'object' then raise exception 'invalid_partner'; end if;
  partner_id:=nullif(p_partner->>'id','')::uuid;
  if partner_id is null then raise exception 'invalid_partner'; end if;
  perform pg_advisory_xact_lock(hashtextextended(partner_id::text,0));
  if partner_id is not null then
    select * into existing from platform_partners where id=partner_id for update;
    if found then
      if existing.last_request=p_partner and existing.revision in (p_expected_revision,p_expected_revision+1) then
        return jsonb_build_object('ok',true,'partnerId',existing.id,'revision',existing.revision);
      end if;
      if existing.revision<>p_expected_revision then raise exception 'revision_conflict'; end if;
    -- Reassigning an advertised partner to a different business category is
    -- an explicit new record; historical settlements keep their partner type.
      if existing.service_key is distinct from p_partner->>'serviceKey' then raise exception 'partner_service_conflict'; end if;
    elsif p_expected_revision<>0 then raise exception 'revision_conflict'; end if;
  end if;
  insert into platform_partners(id,service_key,name,region,address,website_url,phone,active,consumer_rate,referrer_rate,referrer_basis,
    ad_period_start,ad_period_end,ad_placement,ad_fee,revision,last_request)
  values(coalesce(partner_id,gen_random_uuid()),p_partner->>'serviceKey',trim(p_partner->>'name'),trim(p_partner->>'region'),
    coalesce(p_partner->>'address',''),coalesce(p_partner->>'websiteUrl',''),coalesce(p_partner->>'phone',''),
    (p_partner->>'active')::boolean,(p_partner->>'consumerRate')::numeric,(p_partner->>'referrerRate')::numeric,p_partner->>'referrerBasis',
    nullif(p_partner->>'adPeriodStart','')::date,nullif(p_partner->>'adPeriodEnd','')::date,p_partner->>'adPlacement',
    nullif(p_partner->>'adFee','')::bigint,case when existing.id is null then 0 else existing.revision+1 end,p_partner)
  on conflict(id) do update set name=excluded.name,region=excluded.region,address=excluded.address,
    website_url=excluded.website_url,phone=excluded.phone,active=excluded.active,consumer_rate=excluded.consumer_rate,
    referrer_rate=excluded.referrer_rate,referrer_basis=excluded.referrer_basis,ad_period_start=excluded.ad_period_start,
    ad_period_end=excluded.ad_period_end,ad_placement=excluded.ad_placement,ad_fee=excluded.ad_fee,
    revision=excluded.revision,last_request=excluded.last_request,updated_at=now() returning * into saved;
  return jsonb_build_object('ok',true,'partnerId',saved.id,'revision',saved.revision);
end $$;

create or replace function public.settle_platform_application(p_admin_id uuid,p_application_id uuid,p_partner_id uuid,
 p_commission_amount bigint,p_settled_at timestamptz,p_idempotency_key uuid,p_transaction_reference text,p_evidence_reference text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a platform_service_applications; p platform_partners; s platform_partner_settlements; buyer_amount bigint; referrer_amount bigint;
begin
  if not exists(select from admin_accounts where id=p_admin_id and active and staff_type='admin') then raise exception 'forbidden'; end if;
  select * into a from platform_service_applications where id=p_application_id for update;
  if not found or a.status='cancelled' then raise exception 'application_unavailable'; end if;
  select * into s from platform_partner_settlements where application_id=a.id;
  if found then
    if s.idempotency_key is distinct from p_idempotency_key or s.partner_id is distinct from p_partner_id or s.commission_amount is distinct from p_commission_amount
      or s.settled_at is distinct from p_settled_at or s.transaction_reference is distinct from trim(p_transaction_reference)
      or s.evidence_reference is distinct from trim(p_evidence_reference)
    then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('ok',true,'settlementId',s.id,'dueAt',s.due_at);
  end if;
  select * into p from platform_partners where id=p_partner_id and active for share;
  if not found or p.service_key<>a.service_key or p.service_key in ('hospital','insurance') then raise exception 'partner_unavailable'; end if;
  if p_settled_at is null or p_settled_at>now() or p_commission_amount is null or p_commission_amount<0 then raise exception 'invalid_settlement'; end if;
  buyer_amount:=floor(p_commission_amount*p.consumer_rate);
  referrer_amount:=floor((case when p.referrer_basis='after_consumer' then p_commission_amount-buyer_amount else p_commission_amount end)*p.referrer_rate);
  insert into platform_partner_settlements(application_id,partner_id,commission_amount,consumer_rate_snapshot,referrer_rate_snapshot,referrer_basis_snapshot,
    referrer_id_snapshot,transaction_reference,evidence_reference,settled_at,due_at,idempotency_key,recorded_by)
  values(a.id,p.id,p_commission_amount,p.consumer_rate,p.referrer_rate,p.referrer_basis,a.referrer_id_snapshot,
    trim(p_transaction_reference),trim(p_evidence_reference),p_settled_at,p_settled_at+interval '7 days',p_idempotency_key,p_admin_id)
  returning * into s;
  insert into platform_member_benefits(settlement_id,member_id,service_key,kind,amount,due_at)
  values(s.id,a.member_id,a.service_key,'consumer',buyer_amount,s.due_at);
  if s.referrer_id_snapshot is not null then
    insert into platform_member_benefits(settlement_id,member_id,service_key,kind,amount,due_at)
    values(s.id,s.referrer_id_snapshot,a.service_key,'direct_referrer',referrer_amount,s.due_at);
  end if;
  update platform_service_applications set status='settled' where id=a.id;
  return jsonb_build_object('ok',true,'settlementId',s.id,'dueAt',s.due_at);
end $$;

create or replace function public.cancel_platform_application(p_member_id uuid,p_application_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a platform_service_applications;
begin
  select * into a from platform_service_applications where id=p_application_id and member_id=p_member_id for update;
  if not found then raise exception 'application_unavailable'; end if;
  if a.status='settled' then raise exception 'settled_cancellation_requires_reconciliation'; end if;
  update platform_service_applications set status='cancelled' where id=a.id;
  return jsonb_build_object('ok',true,'applicationId',a.id,'status','cancelled');
end $$;

create or replace function public.mark_platform_benefit_paid(p_admin_id uuid,p_benefit_id uuid,p_paid_at timestamptz,p_transfer_reference text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare b platform_member_benefits;
begin
  if not exists(select from admin_accounts where id=p_admin_id and active and staff_type='admin') then raise exception 'forbidden'; end if;
  if p_paid_at is null or p_paid_at>now() or nullif(trim(p_transfer_reference),'') is null then raise exception 'invalid_transfer'; end if;
  select * into b from platform_member_benefits where id=p_benefit_id for update;
  if not found then raise exception 'benefit_unavailable'; end if;
  if b.status='paid' and (b.paid_at is distinct from p_paid_at or b.transfer_reference is distinct from trim(p_transfer_reference))
  then raise exception 'idempotency_conflict'; end if;
  update platform_member_benefits set status='paid',paid_at=p_paid_at,transfer_reference=trim(p_transfer_reference) where id=b.id;
  return jsonb_build_object('ok',true,'benefitId',b.id,'status','paid');
end $$;

create or replace function public.delete_platform_member(p_member_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members;
begin
  select * into m from platform_members where id=p_member_id and active for update;
  if not found then raise exception 'member_unavailable'; end if;
  if m.fc_id is not null then raise exception 'fc_deletion_requires_existing_workflow'; end if;
  delete from platform_member_credentials where member_id=m.id;
  delete from platform_signup_challenges where phone=m.phone;
  update platform_service_applications set details='{"region":"삭제","requestType":"삭제"}'::jsonb,
    status=case when status='interest' then 'cancelled' else status end where member_id=m.id;
  update platform_members set phone=null,name='탈퇴 회원',active=false where id=m.id;
  return jsonb_build_object('ok',true,'deleted',true);
end $$;

-- No storage is introduced; private additional information and financial rows
-- are accessible only through verified actor paths in the Edge handler.
do $$ declare t text; f record; begin
  foreach t in array array['platform_members','platform_member_credentials','platform_signup_challenges','platform_partners',
    'platform_service_applications','platform_partner_settlements','platform_member_benefits'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('issue_platform_signup_otp','register_platform_member','platform_login_attempt','create_platform_application',
      'settle_platform_application','cancel_platform_application','mark_platform_benefit_paid','save_platform_partner','delete_platform_member') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
