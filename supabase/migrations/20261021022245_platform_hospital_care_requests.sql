-- Care reservation requests from a partner hospital detail screen. The member
-- asks for a start date; staff confirm, adjust or decline and the confirmation
-- carries the pre-care checklist in the app. No patient health information is
-- collected here: staff gather it by phone after the request.
create table public.platform_hospital_care_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.platform_members(id),
  hospital_id uuid not null,
  hospital_name text not null check (length(hospital_name) between 1 and 100),
  desired_start date not null,
  care_type text not null check (care_type in ('full_day','day_time')),
  contact_time text not null check (contact_time in ('morning','afternoon','evening','anytime')),
  status text not null default 'requested'
    check (status in ('requested','reviewing','confirmed','adjusted','declined','cancelled')),
  staff_note text check (staff_note is null or length(staff_note) between 1 and 500),
  responded_at timestamptz,
  responded_by uuid references public.admin_accounts(id),
  -- Response-time milestones. The due time is fixed at insert so later policy edits do not rewrite history.
  first_contact_due_at timestamptz not null,
  first_contact_at timestamptz,
  decided_at timestamptz,
  care_started_at timestamptz,
  sla_escalated_at timestamptz,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(member_id,idempotency_key)
);
create index platform_hospital_care_requests_owner on public.platform_hospital_care_requests(member_id,created_at desc);
create index platform_hospital_care_requests_open on public.platform_hospital_care_requests(created_at desc)
  where status in ('requested','reviewing');

-- Expo push tokens of common members, used to tell a member that staff answered
-- a care request. A device belongs to the member who registered it last.
create table public.platform_member_push_tokens (
  expo_push_token text primary key check (length(expo_push_token) between 1 and 200),
  member_id uuid not null references public.platform_members(id),
  platform text not null check (platform in ('ios','android')),
  updated_at timestamptz not null default now()
);
create index platform_member_push_tokens_member on public.platform_member_push_tokens(member_id);

-- First-contact target: 30 minutes within 08:00-22:00 Seoul time; requests outside
-- those hours start the clock at the next 08:00. Defaults are an operating assumption.
create or replace function public.hospital_care_first_contact_due_v1(p_created timestamptz,
  p_minutes int default 30, p_open time default '08:00', p_close time default '22:00')
returns timestamptz language sql stable set search_path=public,pg_temp as $$
  select ((case
      when local_time::time < p_open then local_time::date + p_open
      when local_time::time >= p_close then local_time::date + 1 + p_open
      else local_time end) + make_interval(mins => p_minutes)) at time zone 'Asia/Seoul'
  from (select p_created at time zone 'Asia/Seoul' as local_time) seoul
$$;

create or replace function public.create_hospital_care_request_v1(p_member_id uuid,p_request jsonb,p_idempotency_key uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r platform_hospital_care_requests; m platform_members; today date := (now() at time zone 'Asia/Seoul')::date; start_on date;
begin
  select * into m from platform_members where id=p_member_id and active for update;
  if not found then raise exception 'member_unavailable'; end if;
  if jsonb_typeof(p_request) is distinct from 'object'
    or (p_request-'hospitalId'-'hospitalName'-'desiredStart'-'careType'-'contactTime')<>'{}'::jsonb
    or jsonb_typeof(p_request->'hospitalName') is distinct from 'string'
    or length(p_request->>'hospitalName') not between 1 and 100
    or coalesce(p_request->>'careType','') not in ('full_day','day_time')
    or coalesce(p_request->>'contactTime','') not in ('morning','afternoon','evening','anytime')
    or coalesce(p_request->>'desiredStart','') !~ '^\d{4}-\d{2}-\d{2}$'
  then raise exception 'invalid_details'; end if;
  start_on := (p_request->>'desiredStart')::date;
  if start_on < today or start_on > today + 90 then raise exception 'invalid_details'; end if;
  select * into r from platform_hospital_care_requests where member_id=m.id and idempotency_key=p_idempotency_key;
  if not found then
    if (select count(*) from platform_hospital_care_requests where member_id=m.id and status in ('requested','reviewing')) >= 3
      then raise exception 'care_request_limit'; end if;
    insert into platform_hospital_care_requests(member_id,hospital_id,hospital_name,desired_start,care_type,contact_time,idempotency_key,first_contact_due_at)
    values(m.id,(p_request->>'hospitalId')::uuid,p_request->>'hospitalName',start_on,p_request->>'careType',p_request->>'contactTime',p_idempotency_key,
      hospital_care_first_contact_due_v1(now()))
    returning * into r;
    -- Only the first insert reports created=true, so a retried request does not notify staff twice.
    return jsonb_build_object('ok',true,'requestId',r.id,'status',r.status,'created',true);
  elsif r.hospital_id<>(p_request->>'hospitalId')::uuid or r.desired_start<>start_on
    or r.care_type<>p_request->>'careType' or r.contact_time<>p_request->>'contactTime' then
    raise exception 'idempotency_conflict';
  end if;
  return jsonb_build_object('ok',true,'requestId',r.id,'status',r.status,'created',false);
end $$;

create or replace function public.cancel_hospital_care_request_v1(p_member_id uuid,p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r platform_hospital_care_requests;
begin
  select * into r from platform_hospital_care_requests where id=p_request_id and member_id=p_member_id for update;
  if not found then raise exception 'application_unavailable'; end if;
  if r.status='cancelled' then return jsonb_build_object('ok',true,'requestId',r.id,'status',r.status); end if;
  if r.status not in ('requested','reviewing','adjusted') then raise exception 'application_unavailable'; end if;
  update platform_hospital_care_requests set status='cancelled',updated_at=now() where id=r.id;
  return jsonb_build_object('ok',true,'requestId',r.id,'status','cancelled');
end $$;

create or replace function public.respond_hospital_care_request_v1(p_admin_id uuid,p_request_id uuid,p_status text,p_note text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r platform_hospital_care_requests; note text := nullif(btrim(coalesce(p_note,'')),'');
begin
  if not exists(select from admin_accounts where id=p_admin_id and active and staff_type='admin') then raise exception 'forbidden'; end if;
  if p_status not in ('reviewing','confirmed','adjusted','declined') or length(coalesce(note,'')) > 500
    or (p_status in ('adjusted','declined') and note is null) then raise exception 'invalid_details'; end if;
  select * into r from platform_hospital_care_requests where id=p_request_id for update;
  if not found or r.status='cancelled' then raise exception 'application_unavailable'; end if;
  -- Re-sending the same decision is a no-op so a retried request does not notify twice.
  if r.status=p_status and r.staff_note is not distinct from note then
    return jsonb_build_object('ok',true,'requestId',r.id,'status',r.status,'memberId',r.member_id,'changed',false);
  end if;
  -- Any staff answer implies the member was reached; final decisions keep their first decision time.
  update platform_hospital_care_requests set status=p_status,staff_note=note,responded_at=now(),responded_by=p_admin_id,updated_at=now(),
    first_contact_at=coalesce(first_contact_at,now()),
    decided_at=case when p_status in ('confirmed','adjusted','declined') then coalesce(decided_at,now()) else decided_at end
    where id=r.id;
  return jsonb_build_object('ok',true,'requestId',r.id,'status',p_status,'memberId',r.member_id,'changed',true);
end $$;

-- Staff milestones outside a decision: the first phone contact and the actual care start.
create or replace function public.mark_hospital_care_milestone_v1(p_admin_id uuid,p_request_id uuid,p_milestone text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r platform_hospital_care_requests;
begin
  if not exists(select from admin_accounts where id=p_admin_id and active and staff_type='admin') then raise exception 'forbidden'; end if;
  if p_milestone not in ('first_contact','care_started') then raise exception 'invalid_details'; end if;
  select * into r from platform_hospital_care_requests where id=p_request_id for update;
  if not found or r.status='cancelled' or (p_milestone='care_started' and r.status<>'confirmed') then raise exception 'application_unavailable'; end if;
  if (p_milestone='first_contact' and r.first_contact_at is not null) or (p_milestone='care_started' and r.care_started_at is not null) then
    return jsonb_build_object('ok',true,'requestId',r.id,'changed',false);
  end if;
  update platform_hospital_care_requests set updated_at=now(),
    first_contact_at=coalesce(first_contact_at,now()),
    status=case when p_milestone='first_contact' and status='requested' then 'reviewing' else status end,
    care_started_at=case when p_milestone='care_started' then now() else care_started_at end
    where id=r.id;
  return jsonb_build_object('ok',true,'requestId',r.id,'changed',true);
end $$;

-- Claims requests past their first-contact due time exactly once, for one staff reminder.
create or replace function public.claim_overdue_hospital_care_v1(p_now timestamptz default now())
returns int language plpgsql security invoker set search_path=public,pg_temp as $$
declare claimed int;
begin
  update platform_hospital_care_requests set sla_escalated_at=p_now
    where status in ('requested','reviewing') and first_contact_at is null and sla_escalated_at is null and first_contact_due_at<p_now;
  get diagnostics claimed=row_count;
  return claimed;
end $$;

-- Response-time report for admins. Withdrawn members' requests are purged and do not count.
create or replace function public.get_hospital_care_metrics_v1(p_admin_id uuid,p_since timestamptz,p_now timestamptz default now())
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if not exists(select from admin_accounts where id=p_admin_id and active and staff_type='admin') then raise exception 'forbidden'; end if;
  select jsonb_build_object('ok',true,'since',p_since,'requests',count(*),
    'firstContactDue',count(*) filter (where first_contact_at is not null or first_contact_due_at<p_now),
    'firstContactOnTime',count(*) filter (where first_contact_at<=first_contact_due_at),
    'overdueNow',count(*) filter (where status in ('requested','reviewing') and first_contact_at is null and first_contact_due_at<p_now),
    'medianFirstContactMinutes',round((percentile_cont(0.5) within group (order by extract(epoch from first_contact_at-created_at)/60)
      filter (where first_contact_at is not null))::numeric,1),
    'medianDecisionMinutes',round((percentile_cont(0.5) within group (order by extract(epoch from decided_at-created_at)/60)
      filter (where decided_at is not null))::numeric,1),
    'confirmed',count(*) filter (where status='confirmed'),'started',count(care_started_at))
  into result from platform_hospital_care_requests where created_at>=p_since;
  return result;
end $$;

-- Withdrawal (delete_platform_member and the insurance/all-affiliate paths) ends
-- with active=false. Removing rows here keeps every withdrawal path covered.
create or replace function public.purge_platform_member_care_data_on_withdrawal()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  delete from platform_hospital_care_requests where member_id=new.id;
  delete from platform_member_push_tokens where member_id=new.id;
  return new;
end $$;
create trigger platform_members_purge_care_data
  after update of active on public.platform_members
  for each row when (old.active and not new.active)
  execute function public.purge_platform_member_care_data_on_withdrawal();

do $$ declare t text; f record; begin
  foreach t in array array['platform_hospital_care_requests','platform_member_push_tokens'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('create_hospital_care_request_v1','cancel_hospital_care_request_v1','respond_hospital_care_request_v1',
      'hospital_care_first_contact_due_v1','mark_hospital_care_milestone_v1','claim_overdue_hospital_care_v1','get_hospital_care_metrics_v1',
      'purge_platform_member_care_data_on_withdrawal') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
