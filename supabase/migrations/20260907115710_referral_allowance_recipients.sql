-- Expand the existing pilot without changing published snapshots or account roles.
create table public.referral_allowance_recipients (
  beneficiary_fc_id uuid primary key references public.fc_profiles(id),
  manager_account_id uuid unique references public.manager_accounts(id),
  employee_code text not null unique check (employee_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  enabled boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.referral_allowance_recipients enable row level security;
revoke all on public.referral_allowance_recipients from public, anon, authenticated;
grant select, insert, update on public.referral_allowance_recipients to service_role;
insert into public.referral_allowance_recipients
  (beneficiary_fc_id,manager_account_id,employee_code,enabled,revision,updated_by,created_at,updated_at)
select beneficiary_fc_id,manager_account_id,employee_code,enabled,revision,updated_by,created_at,updated_at
from public.referral_allowance_pilot;
alter table public.referral_allowance_imports alter column manager_account_id drop not null;

create or replace function public.referral_allowance_pair_is_valid(p_manager_account_id uuid, p_beneficiary_fc_id uuid)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.fc_profiles f where f.id = p_beneficiary_fc_id
      and regexp_replace(f.phone, '[^0-9]', '', 'g') ~ '^[0-9]{11}$'
      and position('설계매니저' in coalesce(f.affiliation, '')) = 0
      and not exists (select 1 from public.admin_accounts a
        where regexp_replace(a.phone, '[^0-9]', '', 'g') = regexp_replace(f.phone, '[^0-9]', '', 'g'))
      and (select count(*) from public.fc_profiles other
        where regexp_replace(other.phone, '[^0-9]', '', 'g') = regexp_replace(f.phone, '[^0-9]', '', 'g')) = 1
      and ((p_manager_account_id is null and f.signup_completed = true
        and coalesce(f.is_manager_referral_shadow, false) = false
        and not exists (select 1 from public.manager_accounts m
          where regexp_replace(m.phone, '[^0-9]', '', 'g') = regexp_replace(f.phone, '[^0-9]', '', 'g')))
      or (p_manager_account_id is not null and (f.signup_completed = true or f.is_manager_referral_shadow = true)
        and exists (select 1 from public.manager_accounts m where m.id = p_manager_account_id and m.active = true
          and regexp_replace(m.phone, '[^0-9]', '', 'g') = regexp_replace(f.phone, '[^0-9]', '', 'g'))))
  );
$$;


create or replace function public.configure_referral_allowance_pilot(
  p_actor_admin_id uuid, p_manager_account_id uuid, p_beneficiary_fc_id uuid,
  p_employee_code text, p_enabled boolean, p_expected_revision bigint
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_pilot public.referral_allowance_recipients%rowtype;
begin
  if not exists (select 1 from public.admin_accounts where id = p_actor_admin_id and active = true) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  if p_employee_code is null or p_employee_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
    or p_enabled is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_allowance_request';
  end if;
  perform pg_advisory_xact_lock(904920260907::bigint);
  select * into v_pilot from public.referral_allowance_recipients where beneficiary_fc_id = p_beneficiary_fc_id for update;
  if coalesce(v_pilot.revision, 0) <> p_expected_revision then
    raise exception using errcode = '40001', message = 'allowance_revision_conflict';
  end if;
  -- Revocation of the current pair must remain possible after account deactivation.
  if not coalesce((p_enabled = false and v_pilot.manager_account_id is not distinct from p_manager_account_id
    and v_pilot.beneficiary_fc_id = p_beneficiary_fc_id and v_pilot.employee_code = p_employee_code), false)
    and not public.referral_allowance_pair_is_valid(p_manager_account_id, p_beneficiary_fc_id) then
    raise exception using errcode = '22023', message = 'invalid_allowance_pilot_pair';
  end if;
  insert into public.referral_allowance_recipients
    (manager_account_id, beneficiary_fc_id, employee_code, enabled, revision, updated_by)
  values (p_manager_account_id, p_beneficiary_fc_id, p_employee_code, p_enabled, p_expected_revision + 1, p_actor_admin_id)
  on conflict (beneficiary_fc_id) do update set manager_account_id = excluded.manager_account_id,
    beneficiary_fc_id = excluded.beneficiary_fc_id, employee_code = excluded.employee_code,
    enabled = excluded.enabled, revision = excluded.revision, updated_by = excluded.updated_by, updated_at = now()
  returning * into v_pilot;
  return jsonb_build_object('ok', true, 'pilot', jsonb_build_object(
    'managerAccountId', v_pilot.manager_account_id, 'beneficiaryFcId', v_pilot.beneficiary_fc_id,
    'employeeCode', v_pilot.employee_code, 'enabled', v_pilot.enabled, 'revision', v_pilot.revision));
end;
$$;

create or replace function public.create_referral_allowance_draft(
  p_actor_admin_id uuid, p_expected_pilot_revision bigint, p_expected_manager_account_id uuid,
  p_expected_beneficiary_fc_id uuid, p_expected_employee_code text, p_performance_month text,
  p_payment_date date, p_genealogy_as_of date, p_source_sha256 text, p_policy_version text, p_snapshot jsonb
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_pilot public.referral_allowance_recipients%rowtype;
  v_import public.referral_allowance_imports%rowtype;
  v_count integer;
  v_revision bigint;
begin
  if not exists (select 1 from public.admin_accounts where id = p_actor_admin_id and active = true) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  perform pg_advisory_xact_lock(904920260907::bigint);
  select * into v_pilot from public.referral_allowance_recipients where beneficiary_fc_id = p_expected_beneficiary_fc_id for update;
  if v_pilot.beneficiary_fc_id is null or v_pilot.enabled is not true
    or v_pilot.revision is distinct from p_expected_pilot_revision
    or v_pilot.manager_account_id is distinct from p_expected_manager_account_id
    or v_pilot.beneficiary_fc_id is distinct from p_expected_beneficiary_fc_id
    or v_pilot.employee_code is distinct from p_expected_employee_code then
    raise exception using errcode = '40001', message = 'allowance_pilot_changed';
  end if;
  if not public.referral_allowance_pair_is_valid(v_pilot.manager_account_id, v_pilot.beneficiary_fc_id) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  if p_performance_month is null or p_performance_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
    or p_payment_date is null or p_genealogy_as_of is null
    or p_source_sha256 is null or p_source_sha256 !~ '^[0-9a-f]{64}$'
    or p_policy_version is distinct from 'recruitment-2026-09-07-snapshot-pilot-v1'
    or p_snapshot is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or octet_length(p_snapshot::text) > 8388608 then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if p_genealogy_as_of > p_payment_date
    or to_char(p_payment_date, 'YYYY-MM') is distinct from
      to_char(to_date(p_performance_month || '-01', 'YYYY-MM-DD') + interval '2 months', 'YYYY-MM') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if p_snapshot->'schemaVersion' is distinct from '1'::jsonb
    or p_snapshot->>'policyVersion' is distinct from p_policy_version
    or p_snapshot->>'performanceMonth' is distinct from p_performance_month
    or p_snapshot->>'paymentDate' is distinct from to_char(p_payment_date, 'YYYY-MM-DD')
    or p_snapshot->>'genealogyAsOf' is distinct from to_char(p_genealogy_as_of, 'YYYY-MM-DD')
    or p_snapshot->>'eligibilityBasis' is distinct from 'uploaded_snapshot'
    or jsonb_typeof(p_snapshot->'sourceSnapshotDates') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'usesLaterSnapshot') is distinct from 'boolean'
    or p_snapshot->>'status' is distinct from 'current_month_estimate'
    or p_snapshot->'previousCarryIncluded' is distinct from 'false'::jsonb
    or jsonb_typeof(p_snapshot->'nodes') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'beneficiary') is distinct from 'object'
    or jsonb_typeof(p_snapshot->'summary') is distinct from 'object'
    or p_snapshot#>'{validation,maximumDepth}' is distinct from '10'::jsonb
    or p_snapshot#>'{validation,conservationDifferenceKrw}' is distinct from '0'::jsonb then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  -- Keep the uploaded source dates distinct from the operator's reference date.
  -- Later source snapshots are explicitly allowed for this pilot and disclosed.
  if jsonb_array_length(p_snapshot->'sourceSnapshotDates') not between 1 and 64
    or exists (select 1 from jsonb_array_elements(p_snapshot->'sourceSnapshotDates') d
      where jsonb_typeof(d) is distinct from 'string'
        or (d #>> '{}') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  begin
    if exists (select 1 from jsonb_array_elements_text(p_snapshot->'sourceSnapshotDates') d
      where to_char(to_date(d, 'YYYY-MM-DD'), 'YYYY-MM-DD') is distinct from d) then
      raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
    end if;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end;
  if (select jsonb_agg(d order by d) from
      (select distinct d from jsonb_array_elements_text(p_snapshot->'sourceSnapshotDates') d) dates)
      is distinct from p_snapshot->'sourceSnapshotDates'
    or p_snapshot->'usesLaterSnapshot' is distinct from to_jsonb(exists (
      select 1 from jsonb_array_elements_text(p_snapshot->'sourceSnapshotDates') d
      where d > to_char(p_genealogy_as_of, 'YYYY-MM-DD'))) then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  v_count := jsonb_array_length(p_snapshot->'nodes');
  if v_count < 1 or v_count > 10000
    or p_snapshot#>>'{validation,visiblePeopleCount}' is distinct from v_count::text
    or (select count(*) from jsonb_array_elements(p_snapshot->'nodes') n where n->'isBeneficiary' = 'true'::jsonb) <> 1
    or not exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n
      where n->>'id' = p_snapshot#>>'{beneficiary,nodeId}' and n->'isBeneficiary' = 'true'::jsonb and n->>'depth' = '0') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  -- Only the public beneficiary statement shape may be persisted, never raw workbook columns.
  if exists (select 1 from jsonb_object_keys(p_snapshot) k where k not in
      ('schemaVersion','policyVersion','performanceMonth','paymentDate','genealogyAsOf','sourceSnapshotDates','usesLaterSnapshot','status',
       'previousCarryIncluded','eligibilityBasis','beneficiary','nodes','summary','validation'))
    or exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n where jsonb_typeof(n) <> 'object') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n, jsonb_object_keys(n) k where k not in
      ('id','parentId','depth','name','affiliation','isBeneficiary','activeAtPerformance','eligibleAtBasisDate',
       'finalTargetPerformanceKrw','fpRoundedAmountKrw','contributionKrw'))
    or exists (select 1 from jsonb_object_keys(p_snapshot->'beneficiary') k where k not in ('nodeId','name','eligibleAtBasisDate'))
    or exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n where
      coalesce(n->>'id', '') !~ '^node-[0-9]{1,5}$' or coalesce(n->>'depth', '') !~ '^(10|[0-9])$'
      or jsonb_typeof(n->'name') is distinct from 'string' or jsonb_typeof(n->'affiliation') is distinct from 'string'
      or jsonb_typeof(n->'isBeneficiary') is distinct from 'boolean'
      or jsonb_typeof(n->'activeAtPerformance') is distinct from 'boolean'
      or jsonb_typeof(n->'eligibleAtBasisDate') is distinct from 'boolean')
    or (select count(distinct n->>'id') from jsonb_array_elements(p_snapshot->'nodes') n) <> v_count then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n where
      jsonb_typeof(n->'finalTargetPerformanceKrw') is distinct from 'number'
      or coalesce(n->>'finalTargetPerformanceKrw', '') !~ '^-?[0-9]{1,14}(\.[0-9]{1,2})?$')
    or exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n,
      unnest(array['fpRoundedAmountKrw','contributionKrw']) k
      where jsonb_typeof(n->k) is distinct from 'number' or coalesce(n->>k, '') !~ '^-?[0-9]{1,16}$')
    or exists (select 1 from unnest(array['currentMonthNetKrw','newPaymentKrw','carryForwardKrw','extinguishedKrw','excludedByEligibilityKrw']) k
      where jsonb_typeof(p_snapshot->'summary'->k) is distinct from 'number'
        or coalesce(p_snapshot->'summary'->>k, '') !~ '^-?[0-9]{1,16}$') then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  if exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n
      where abs((n->>'finalTargetPerformanceKrw')::numeric) * 100 > 9007199254740991)
    or exists (select 1 from jsonb_array_elements(p_snapshot->'nodes') n,
      unnest(array['fpRoundedAmountKrw','contributionKrw']) k where abs((n->>k)::numeric) > 9007199254740991)
    or exists (select 1 from unnest(array['currentMonthNetKrw','newPaymentKrw','carryForwardKrw','extinguishedKrw','excludedByEligibilityKrw']) k
      where abs((p_snapshot->'summary'->>k)::numeric) > 9007199254740991)
    or (select sum((n->>'contributionKrw')::numeric) from jsonb_array_elements(p_snapshot->'nodes') n)
      <> (p_snapshot#>>'{summary,currentMonthNetKrw}')::numeric
    or (p_snapshot#>>'{summary,currentMonthNetKrw}')::numeric <>
      (p_snapshot#>>'{summary,newPaymentKrw}')::numeric + (p_snapshot#>>'{summary,carryForwardKrw}')::numeric
      + (p_snapshot#>>'{summary,extinguishedKrw}')::numeric + (p_snapshot#>>'{summary,excludedByEligibilityKrw}')::numeric then
    raise exception using errcode = '22023', message = 'invalid_allowance_snapshot';
  end if;
  select * into v_import from public.referral_allowance_imports
    where beneficiary_fc_id = v_pilot.beneficiary_fc_id and performance_month = p_performance_month
      and source_sha256 = p_source_sha256 and policy_version = p_policy_version and pilot_revision = v_pilot.revision;
  if v_import.id is not null then
    if v_import.snapshot is distinct from p_snapshot or v_import.payment_date is distinct from p_payment_date
      or v_import.genealogy_as_of is distinct from p_genealogy_as_of or v_import.employee_code is distinct from v_pilot.employee_code
      or v_import.manager_account_id is distinct from v_pilot.manager_account_id then
      raise exception using errcode = '40001', message = 'allowance_idempotency_conflict';
    end if;
  else
    select coalesce(max(revision), 0) + 1 into v_revision from public.referral_allowance_imports
      where beneficiary_fc_id = v_pilot.beneficiary_fc_id and performance_month = p_performance_month;
    insert into public.referral_allowance_imports
      (manager_account_id, beneficiary_fc_id, employee_code, performance_month, payment_date, genealogy_as_of,
        source_sha256, policy_version, pilot_revision, revision, snapshot, created_by)
    values (v_pilot.manager_account_id, v_pilot.beneficiary_fc_id, v_pilot.employee_code, p_performance_month,
      p_payment_date, p_genealogy_as_of, p_source_sha256, p_policy_version, v_pilot.revision, v_revision, p_snapshot, p_actor_admin_id)
    returning * into v_import;
  end if;
  return jsonb_build_object('ok', true, 'import', jsonb_build_object('id', v_import.id, 'status', v_import.status,
    'revision', v_import.revision, 'sourceSha256', v_import.source_sha256, 'policyVersion', v_import.policy_version,
    'performanceMonth', v_import.performance_month, 'pilotRevision', v_import.pilot_revision));
end;
$$;

create or replace function public.publish_referral_allowance_draft(
  p_actor_admin_id uuid, p_import_id uuid, p_expected_source_sha256 text,
  p_expected_revision bigint, p_expected_pilot_revision bigint
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_pilot public.referral_allowance_recipients%rowtype;
  v_import public.referral_allowance_imports%rowtype;
begin
  if not exists (select 1 from public.admin_accounts where id = p_actor_admin_id and active = true) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  perform pg_advisory_xact_lock(904920260907::bigint);
  select * into v_import from public.referral_allowance_imports where id = p_import_id for update;
  select * into v_pilot from public.referral_allowance_recipients where beneficiary_fc_id = v_import.beneficiary_fc_id for update;
  if v_pilot.beneficiary_fc_id is null or v_pilot.enabled is not true or v_import.id is null
    or v_pilot.revision is distinct from p_expected_pilot_revision
    or v_import.pilot_revision is distinct from v_pilot.revision
    or v_import.manager_account_id is distinct from v_pilot.manager_account_id
    or v_import.beneficiary_fc_id is distinct from v_pilot.beneficiary_fc_id
    or v_import.employee_code is distinct from v_pilot.employee_code
    or v_import.source_sha256 is distinct from p_expected_source_sha256
    or v_import.revision is distinct from p_expected_revision
    or v_import.status = 'superseded' then
    raise exception using errcode = '40001', message = 'allowance_revision_conflict';
  end if;
  if not public.referral_allowance_pair_is_valid(v_pilot.manager_account_id, v_pilot.beneficiary_fc_id) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  if v_import.status = 'draft' then
    update public.referral_allowance_imports set status = 'superseded', superseded_at = now()
      where beneficiary_fc_id = v_import.beneficiary_fc_id and performance_month = v_import.performance_month and status = 'published';
    update public.referral_allowance_imports set status = 'published', published_by = p_actor_admin_id, published_at = now()
      where id = v_import.id returning * into v_import;
  end if;
  return jsonb_build_object('ok', true, 'import', jsonb_build_object('id', v_import.id, 'status', v_import.status,
    'revision', v_import.revision, 'sourceSha256', v_import.source_sha256, 'policyVersion', v_import.policy_version,
    'performanceMonth', v_import.performance_month, 'pilotRevision', v_import.pilot_revision));
end;
$$;

create or replace function public.read_referral_allowance_pilot(
  p_manager_account_id uuid, p_beneficiary_fc_id uuid, p_action text, p_month text default null
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_pilot public.referral_allowance_recipients%rowtype;
  v_months jsonb;
  v_snapshot jsonb;
begin
  if p_action is null or p_action not in ('access', 'statement')
    or (p_month is not null and p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') then
    raise exception using errcode = '22023', message = 'invalid_allowance_request';
  end if;
  select * into v_pilot from public.referral_allowance_recipients where beneficiary_fc_id = p_beneficiary_fc_id for share;
  if v_pilot.beneficiary_fc_id is null or v_pilot.enabled is not true
    or v_pilot.manager_account_id is distinct from p_manager_account_id
    or v_pilot.beneficiary_fc_id is distinct from p_beneficiary_fc_id
    or not public.referral_allowance_pair_is_valid(p_manager_account_id, p_beneficiary_fc_id) then
    if p_action = 'access' then return jsonb_build_object('ok', true, 'enabled', false); end if;
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  select coalesce(jsonb_agg(performance_month order by performance_month desc), '[]'::jsonb) into v_months from (
    select performance_month from public.referral_allowance_imports
    where manager_account_id is not distinct from v_pilot.manager_account_id and beneficiary_fc_id = v_pilot.beneficiary_fc_id
      and employee_code = v_pilot.employee_code and pilot_revision = v_pilot.revision and status = 'published'
    order by performance_month desc limit 120
  ) months;
  if p_action = 'access' then return jsonb_build_object('ok', true, 'enabled', true, 'availableMonths', v_months); end if;
  select snapshot into v_snapshot from public.referral_allowance_imports
    where manager_account_id is not distinct from v_pilot.manager_account_id and beneficiary_fc_id = v_pilot.beneficiary_fc_id
      and employee_code = v_pilot.employee_code and pilot_revision = v_pilot.revision and status = 'published'
      and performance_month = coalesce(p_month, v_months->>0);
  return jsonb_build_object('ok', true, 'enabled', true, 'availableMonths', v_months, 'statement', v_snapshot);
end;
$$;

revoke all on function public.referral_allowance_pair_is_valid(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guard_referral_allowance_import_immutability() from public, anon, authenticated;
revoke all on function public.configure_referral_allowance_pilot(uuid, uuid, uuid, text, boolean, bigint) from public, anon, authenticated;
revoke all on function public.create_referral_allowance_draft(uuid, bigint, uuid, uuid, text, text, date, date, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.publish_referral_allowance_draft(uuid, uuid, text, bigint, bigint) from public, anon, authenticated;
revoke all on function public.read_referral_allowance_pilot(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.referral_allowance_pair_is_valid(uuid, uuid) to service_role;
grant execute on function public.guard_referral_allowance_import_immutability() to service_role;
grant execute on function public.configure_referral_allowance_pilot(uuid, uuid, uuid, text, boolean, bigint) to service_role;
grant execute on function public.create_referral_allowance_draft(uuid, bigint, uuid, uuid, text, text, date, date, text, text, jsonb) to service_role;
grant execute on function public.publish_referral_allowance_draft(uuid, uuid, text, bigint, bigint) to service_role;
grant execute on function public.read_referral_allowance_pilot(uuid, uuid, text, text) to service_role;



comment on table public.referral_allowance_recipients is 'Server-managed per-person allowance access; no direct client grants. Existing pilot is preserved.';
