-- Referrers belong to each affiliate service, not to the common membership.
-- A member keeps one Moduon account but holds at most one referrer and one
-- shareable code per service. platform_members.referrer_id stays as history
-- only; new applications snapshot the referrer of their own service.
create table public.platform_service_referral_codes (
  member_id uuid not null references public.platform_members(id) on delete restrict,
  service_key text not null check (service_key in ('care','telecom','rental','car')),
  -- The S prefix never occurs in hexadecimal common codes, so a service code
  -- cannot be mistaken for a legacy common code.
  code text not null unique check (code ~ '^S[0-9A-F]{11}$'),
  created_at timestamptz not null default now(),
  primary key(member_id,service_key)
);
create table public.platform_service_referrals (
  member_id uuid not null references public.platform_members(id) on delete restrict,
  service_key text not null check (service_key in ('care','telecom','rental','car')),
  referrer_id uuid not null references public.platform_members(id) on delete restrict,
  referral_code text not null check (length(referral_code) between 8 and 12),
  source text not null check (source in ('invite_signup','invite_confirmed','manual')),
  created_at timestamptz not null default now(),
  primary key(member_id,service_key),
  check (referrer_id<>member_id)
);
create index platform_service_referrals_referrer on public.platform_service_referrals(service_key,referrer_id);

-- Care links shared before service codes existed carried the inviter's common
-- code. Only the care service honors that legacy form.
create or replace function public.resolve_platform_service_referrer_v1(p_service_key text,p_code text)
returns uuid language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare normalized text:=upper(trim(coalesce(p_code,''))); inviter uuid;
begin
  if p_service_key is null or p_service_key not in ('care','telecom','rental','car')
    or normalized !~ '^[A-Z0-9]{8,12}$' then return null; end if;
  select m.id into inviter from platform_service_referral_codes c join platform_members m on m.id=c.member_id
    where c.code=normalized and c.service_key=p_service_key and m.active
      and (m.terms_accepted_at is not null or m.terms_basis='company_attested_import');
  if inviter is null and p_service_key='care' then
    select id into inviter from platform_members where referral_code=normalized and active
      and (terms_accepted_at is not null or terms_basis='company_attested_import');
  end if;
  return inviter;
end $$;

create or replace function public.ensure_platform_service_referral_code_v1(p_member_id uuid,p_service_key text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; issued text;
begin
  if p_service_key is null or p_service_key not in ('care','telecom','rental','car') then raise exception 'invalid_input'; end if;
  select * into m from platform_members where id=p_member_id and active for update;
  if not found then raise exception 'invalid_input'; end if;
  if m.terms_accepted_at is null and m.terms_basis is distinct from 'company_attested_import' then raise exception 'consent_required'; end if;
  select code into issued from platform_service_referral_codes where member_id=m.id and service_key=p_service_key;
  -- The member row lock serializes issuance, so a conflict can only be a code collision.
  while issued is null loop
    begin
      insert into platform_service_referral_codes(member_id,service_key,code)
        values(m.id,p_service_key,'S'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,11)))
        returning code into issued;
    exception when unique_violation then issued:=null;
    end;
  end loop;
  return jsonb_build_object('ok',true,'serviceKey',p_service_key,'code',issued);
end $$;

create or replace function public.get_platform_service_referral_v1(p_member_id uuid,p_service_key text)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare issued text; bound record;
begin
  if p_service_key is null or p_service_key not in ('care','telecom','rental','car') then raise exception 'invalid_input'; end if;
  select code into issued from platform_service_referral_codes where member_id=p_member_id and service_key=p_service_key;
  select r.source,r.created_at,m.name into bound
    from platform_service_referrals r join platform_members m on m.id=r.referrer_id
    where r.member_id=p_member_id and r.service_key=p_service_key;
  return jsonb_build_object('ok',true,'serviceKey',p_service_key,'code',issued,
    'referrer',case when bound.source is null then null
      else jsonb_build_object('name',bound.name,'source',bound.source,'createdAt',bound.created_at) end);
end $$;

create or replace function public.preview_platform_service_referral_v1(p_member_id uuid,p_service_key text,p_code text)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare inviter uuid;
begin
  inviter:=resolve_platform_service_referrer_v1(p_service_key,p_code);
  if inviter is null or inviter=p_member_id then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  return jsonb_build_object('ok',true,'serviceKey',p_service_key,
    'referrerName',(select name from platform_members where id=inviter));
end $$;

-- First binding wins. Members cannot replace a service referrer themselves;
-- repeating the same referrer is an idempotent success.
create or replace function public.bind_platform_service_referral_v1(p_member_id uuid,p_service_key text,p_code text,p_source text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; inviter uuid; existing platform_service_referrals;
begin
  if p_service_key is null or p_service_key not in ('care','telecom','rental','car')
    or p_source is null or p_source not in ('invite_signup','invite_confirmed','manual') then raise exception 'invalid_input'; end if;
  select * into m from platform_members where id=p_member_id and active for update;
  if not found then raise exception 'invalid_input'; end if;
  if m.terms_accepted_at is null and m.terms_basis is distinct from 'company_attested_import' then raise exception 'consent_required'; end if;
  inviter:=resolve_platform_service_referrer_v1(p_service_key,p_code);
  if inviter is null or inviter=m.id then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_service_referral:'||p_service_key,741014));
  select * into existing from platform_service_referrals where member_id=m.id and service_key=p_service_key;
  if found then
    if existing.referrer_id=inviter then return jsonb_build_object('ok',true,'serviceKey',p_service_key,'alreadyBound',true); end if;
    return jsonb_build_object('ok',false,'code','referral_already_bound');
  end if;
  if exists(with recursive chain(id,path) as (
      select inviter,array[inviter]
      union all select r.referrer_id,c.path||r.referrer_id from platform_service_referrals r join chain c
        on r.member_id=c.id and r.service_key=p_service_key where not r.referrer_id=any(c.path)
    ) select from chain where id=m.id) then return jsonb_build_object('ok',false,'code','invalid_referral'); end if;
  insert into platform_service_referrals(member_id,service_key,referrer_id,referral_code,source)
    values(m.id,p_service_key,inviter,upper(trim(p_code)),p_source);
  return jsonb_build_object('ok',true,'serviceKey',p_service_key,'alreadyBound',false);
end $$;

-- Signup through a service invitation creates the account and its service
-- referrer atomically. An unusable code rolls back the whole signup, after the
-- OTP was verified, so codes cannot be probed without a valid challenge.
create or replace function public.register_platform_member_v2(p_phone text,p_code_hash text,p_name text,
  p_password_hash text,p_password_salt text,p_service_key text,p_service_referral_code text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare registered jsonb; bound jsonb;
begin
  registered:=register_platform_member(p_phone,p_code_hash,p_name,p_password_hash,p_password_salt,null);
  if registered->>'ok' is distinct from 'true' then return registered; end if;
  bound:=bind_platform_service_referral_v1((registered->>'memberId')::uuid,p_service_key,p_service_referral_code,'invite_signup');
  if bound->>'ok' is distinct from 'true' then raise exception 'invalid_referral'; end if;
  return registered;
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
  values(m.id,p_service_key,p_details,(select referrer_id from platform_service_referrals
    where member_id=m.id and service_key=p_service_key),p_idempotency_key) on conflict(member_id,idempotency_key) do nothing;
  select * into a from platform_service_applications where member_id=m.id and idempotency_key=p_idempotency_key;
  if a.service_key<>p_service_key or a.details<>p_details then raise exception 'idempotency_conflict'; end if;
  return jsonb_build_object('ok',true,'applicationId',a.id,'status',a.status);
end $$;

do $$ declare t text; f record; begin
  foreach t in array array['platform_service_referral_codes','platform_service_referrals'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('resolve_platform_service_referrer_v1','ensure_platform_service_referral_code_v1',
      'get_platform_service_referral_v1','preview_platform_service_referral_v1','bind_platform_service_referral_v1',
      'register_platform_member_v2','create_platform_application') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
