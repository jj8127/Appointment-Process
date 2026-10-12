-- Hospital advertising is a regional directory, never a treatment/referral fee.
-- Existing contracts need explicit material/region confirmation before publication.
alter table public.platform_partners
  add column province_code text,
  add column district text not null default '',
  add column specialties text[] not null default '{}',
  add column description text not null default '',
  add column photo_url text not null default '',
  add column opening_hours text not null default '',
  add column verified_at date,
  add column material_approved boolean not null default false,
  add column review_required boolean,
  add column review_number text,
  add column review_expires_at date;
alter table public.platform_partners add constraint platform_hospital_material_bounds check (
  service_key <> 'hospital' or (
    (province_code is null or province_code in ('11','26','27','28','29','30','31','36','41','43','44','46','47','48','50','51','52'))
    and length(district)<=50 and cardinality(specialties)<=10 and array_to_string(specialties,'') !~ '[[:cntrl:]]'
    and length(array_to_string(specialties,''))<=300 and length(description)<=2000 and length(opening_hours)<=500
    and (photo_url='' or (length(photo_url)<=500 and photo_url ~ '^https://[^[:space:]]+$'))
    and length(coalesce(review_number,''))<=100));
create index platform_hospital_region on public.platform_partners(province_code,district,name)
  where service_key='hospital' and active;

-- Only the trusted Edge actor may write/read these rows. No patient, account,
-- raw IP, phone, or user-agent is stored. Session/source digests expire with data.
create table public.platform_hospital_events (
  event_id uuid primary key,
  partner_id uuid not null references public.platform_partners(id),
  revision bigint not null,
  placement text not null check (placement in ('regional_list','regional_featured')),
  partner_name text not null,
  event_type text not null check (event_type in ('impression','detail','phone','directions')),
  session_digest text not null check (session_digest ~ '^[0-9a-f]{64}$'),
  source_digest text not null check (source_digest ~ '^[0-9a-f]{64}$'),
  event_date date not null,
  created_at timestamptz not null default now(),
  unique(partner_id,revision,placement,event_type,session_digest,event_date)
);
create index platform_hospital_events_report on public.platform_hospital_events(event_date,partner_id,revision);
create index platform_hospital_events_source on public.platform_hospital_events(source_digest,created_at);

create or replace function public.get_platform_hospitals(p_today date,p_filters jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb; page_size integer; page_offset integer;
begin
  page_size:=coalesce((p_filters->>'limit')::integer,20);
  page_offset:=coalesce((p_filters->>'offset')::integer,0);
  if p_today is null or page_size not between 1 and 50 or page_offset not between 0 and 10000 then raise exception 'invalid_input'; end if;
  with eligible as (
    select p.* from platform_partners p where service_key='hospital' and active and material_approved
      and province_code is not null and trim(district)<>'' and trim(address)<>'' and verified_at<=p_today
      and review_required is not null and (not review_required or (trim(coalesce(review_number,''))<>'' and review_expires_at>=p_today))
      and ad_period_start<=p_today and ad_period_end>=p_today and ad_placement in ('regional_list','regional_featured')
      and (coalesce(p_filters->>'provinceCode','')='' or province_code=p_filters->>'provinceCode')
      and (coalesce(p_filters->>'district','')='' or district=p_filters->>'district')
      and (coalesce(p_filters->>'specialty','')='' or p_filters->>'specialty'=any(specialties))
      and (coalesce(p_filters->>'search','')='' or position(lower(p_filters->>'search') in lower(name||' '||address))>0)
      and (coalesce(p_filters->>'hospitalId','')='' or id::text=p_filters->>'hospitalId')
  ), cards as (
    select id,name,ad_placement, jsonb_build_object('id',id,'name',name,'region',region,'provinceCode',province_code,
      'district',district,'address',address,'phone',phone,'websiteUrl',website_url,'specialties',specialties,
      'description',description,'photoUrl',photo_url,'openingHours',opening_hours,'verifiedAt',verified_at,
      'adPlacement',ad_placement,'revision',revision) card from eligible
  ), listed as (select card from cards order by case when ad_placement='regional_featured' then 0 else 1 end,name,id limit page_size+1 offset page_offset)
  select jsonb_build_object('ok',true,
    'regions',coalesce((select jsonb_agg(jsonb_build_object('provinceCode',province_code,'districts',districts) order by province_code)
      from (select province_code,jsonb_agg(distinct district order by district) districts from eligible group by province_code) r),'[]'::jsonb),
    'specialties',coalesce((select jsonb_agg(s order by s) from (select distinct unnest(specialties) s from eligible) sp),'[]'::jsonb),
    'hospitals',coalesce((select jsonb_agg(card) from (select card from listed limit page_size) p),'[]'::jsonb),
    'featured',coalesce((select jsonb_agg(card) from (select card from cards where ad_placement='regional_featured'
      order by md5(id::text||':'||coalesce(p_filters->>'rotationBucket',floor(extract(epoch from now())/900)::text)),id limit 5) p),'[]'::jsonb),
    'hasMore',(select count(*)>page_size from listed),'nextOffset',case when (select count(*)>page_size from listed) then page_offset+page_size else null end) into result;
  return result;
end $$;

create or replace function public.record_platform_hospital_event(p_partner_id uuid,p_revision bigint,p_placement text,
  p_event_id uuid,p_event_type text,p_session_digest text,p_source_digest text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare p platform_partners; accepted integer; today date:=(now() at time zone 'Asia/Seoul')::date;
begin
  if p_event_id is null or p_event_type not in ('impression','detail','phone','directions')
    or p_session_digest is null or p_session_digest !~ '^[0-9a-f]{64}$' or p_source_digest is null or p_source_digest !~ '^[0-9a-f]{64}$'
    then raise exception 'invalid_input'; end if;
  select * into p from platform_partners where id=p_partner_id and service_key='hospital' and active and material_approved
    and review_required is not null and (not review_required or (trim(coalesce(review_number,''))<>'' and review_expires_at>=today))
    and province_code is not null and trim(district)<>'' and trim(address)<>'' and verified_at<=today
    and revision=p_revision and p_placement in ('regional_list','regional_featured')
    and (p_placement='regional_list' or ad_placement='regional_featured') and ad_placement in ('regional_list','regional_featured')
    and ad_period_start<=today and ad_period_end>=today for share;
  if not found then return jsonb_build_object('ok',true,'accepted',false); end if;
  if (p_event_type='phone' and p.phone='') or (p_event_type='directions' and p.address='') then raise exception 'invalid_input'; end if;
  -- A signed exposure receipt is validated in Edge; database adds atomic retry,
  -- per-session/day dedup and per-source/minute admission. Anonymous clients can
  -- still fabricate interactions; these are not billing/confirmed-patient metrics.
  perform pg_advisory_xact_lock(hashtextextended(p_source_digest,1));
  if (select count(*) from platform_hospital_events where source_digest=p_source_digest and created_at>now()-interval '1 minute')>=60
    then return jsonb_build_object('ok',true,'accepted',false); end if;
  insert into platform_hospital_events(event_id,partner_id,revision,placement,partner_name,event_type,session_digest,source_digest,event_date)
    values(p_event_id,p.id,p.revision,p_placement,p.name,p_event_type,p_session_digest,p_source_digest,today) on conflict do nothing;
  get diagnostics accepted=row_count;
  delete from platform_hospital_events where event_date<today-90;
  return jsonb_build_object('ok',true,'accepted',accepted=1);
end $$;

create or replace function public.get_platform_hospital_report(p_admin_id uuid,p_from date,p_to date,p_partner_id uuid default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if not exists(select from admin_accounts where id=p_admin_id and active and staff_type='admin') then raise exception 'forbidden'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 then raise exception 'invalid_input'; end if;
  if (select count(*) from (select distinct partner_id,revision,placement,partner_name,event_date from platform_hospital_events
    where event_date between p_from and p_to and event_date>=(now() at time zone 'Asia/Seoul')::date-90
      and (p_partner_id is null or partner_id=p_partner_id) limit 5001) bounded)>5000
    then raise exception 'report_range_too_large'; end if;
  with grouped as (
    select partner_id,revision,placement,partner_name,event_date,
      count(*) filter(where event_type='impression') impressions,count(*) filter(where event_type='detail') detail_views,
      count(*) filter(where event_type='phone') phone_clicks,count(*) filter(where event_type='directions') directions_clicks
    from platform_hospital_events where event_date between p_from and p_to and (p_partner_id is null or partner_id=p_partner_id)
      and event_date >= (now() at time zone 'Asia/Seoul')::date-90
    group by partner_id,revision,placement,partner_name,event_date
  ) select jsonb_build_object('ok',true,'from',p_from,'to',p_to,'measurement','anonymous_client_events',
    'rows',coalesce(jsonb_agg(jsonb_build_object('partnerId',partner_id,'name',partner_name,'revision',revision,'placement',placement,
      'date',event_date,'impressions',impressions,'detailViews',detail_views,'phoneClicks',phone_clicks,'directionsClicks',directions_clicks)
      order by event_date desc,partner_id,revision),'[]'::jsonb),
    'totals',jsonb_build_object('impressions',coalesce(sum(impressions),0),'detailViews',coalesce(sum(detail_views),0),
      'phoneClicks',coalesce(sum(phone_clicks),0),'directionsClicks',coalesce(sum(directions_clicks),0))) into result from grouped;
  return result;
end $$;

alter table public.platform_hospital_events enable row level security;
revoke all on public.platform_hospital_events from public,anon,authenticated;
grant select,insert,delete on public.platform_hospital_events to service_role;
do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('get_platform_hospitals','record_platform_hospital_event','get_platform_hospital_report') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
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
  if p_partner->>'serviceKey'='hospital' then
    if cardinality(array(select jsonb_array_elements_text(coalesce(p_partner->'specialties','[]'::jsonb))))>10
      or exists(select from jsonb_array_elements_text(coalesce(p_partner->'specialties','[]'::jsonb)) s
        where s is null or length(trim(s)) not between 1 and 30) then raise exception 'invalid_partner'; end if;
    if (p_partner->>'active')::boolean and (
      coalesce((p_partner->>'materialApproved')::boolean,false)=false or p_partner->>'reviewRequired' is null
      or p_partner->>'provinceCode' is null or trim(coalesce(p_partner->>'district',''))='' or trim(coalesce(p_partner->>'address',''))=''
      or nullif(p_partner->>'verifiedAt','')::date is null or (p_partner->>'verifiedAt')::date>(now() at time zone 'Asia/Seoul')::date
      or coalesce(p_partner->>'adPlacement','') not in ('regional_list','regional_featured')
      or ((p_partner->>'reviewRequired')::boolean and (trim(coalesce(p_partner->>'reviewNumber',''))=''
        or nullif(p_partner->>'reviewExpiresAt','')::date is null or (p_partner->>'reviewExpiresAt')::date<(now() at time zone 'Asia/Seoul')::date)))
      then raise exception 'invalid_partner'; end if;
  end if;
  insert into platform_partners(id,service_key,name,region,address,website_url,phone,active,consumer_rate,referrer_rate,referrer_basis,
    ad_period_start,ad_period_end,ad_placement,ad_fee,revision,last_request,province_code,district,specialties,description,photo_url,opening_hours,verified_at,material_approved,review_required,review_number,review_expires_at)
  values(coalesce(partner_id,gen_random_uuid()),p_partner->>'serviceKey',trim(p_partner->>'name'),trim(p_partner->>'region'),
    coalesce(p_partner->>'address',''),coalesce(p_partner->>'websiteUrl',''),coalesce(p_partner->>'phone',''),
    (p_partner->>'active')::boolean,(p_partner->>'consumerRate')::numeric,(p_partner->>'referrerRate')::numeric,p_partner->>'referrerBasis',
    nullif(p_partner->>'adPeriodStart','')::date,nullif(p_partner->>'adPeriodEnd','')::date,p_partner->>'adPlacement',
    nullif(p_partner->>'adFee','')::bigint,case when existing.id is null then 0 else existing.revision+1 end,p_partner,
    nullif(p_partner->>'provinceCode',''),coalesce(p_partner->>'district',''),array(select jsonb_array_elements_text(coalesce(p_partner->'specialties','[]'::jsonb))),
    coalesce(p_partner->>'description',''),coalesce(p_partner->>'photoUrl',''),coalesce(p_partner->>'openingHours',''),nullif(p_partner->>'verifiedAt','')::date,
    coalesce((p_partner->>'materialApproved')::boolean,false),(p_partner->>'reviewRequired')::boolean,nullif(p_partner->>'reviewNumber',''),nullif(p_partner->>'reviewExpiresAt','')::date)
  on conflict(id) do update set name=excluded.name,region=excluded.region,address=excluded.address,
    website_url=excluded.website_url,phone=excluded.phone,active=excluded.active,consumer_rate=excluded.consumer_rate,
    referrer_rate=excluded.referrer_rate,referrer_basis=excluded.referrer_basis,ad_period_start=excluded.ad_period_start,
    ad_period_end=excluded.ad_period_end,ad_placement=excluded.ad_placement,ad_fee=excluded.ad_fee,
    revision=excluded.revision,last_request=excluded.last_request,province_code=excluded.province_code,district=excluded.district,
    specialties=excluded.specialties,description=excluded.description,photo_url=excluded.photo_url,opening_hours=excluded.opening_hours,
    verified_at=excluded.verified_at,material_approved=excluded.material_approved,review_required=excluded.review_required,
    review_number=excluded.review_number,review_expires_at=excluded.review_expires_at,updated_at=now() returning * into saved;
  return jsonb_build_object('ok',true,'partnerId',saved.id,'revision',saved.revision);
end $$;
