-- One explicitly configured manager pilot. No configuration or production data is seeded.
create table if not exists public.referral_allowance_pilot (
  id boolean primary key default true check (id),
  manager_account_id uuid not null references public.manager_accounts(id),
  beneficiary_fc_id uuid not null references public.fc_profiles(id),
  employee_code text not null check (employee_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  enabled boolean not null default false,
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referral_allowance_imports (
  id uuid primary key default gen_random_uuid(),
  manager_account_id uuid not null references public.manager_accounts(id),
  beneficiary_fc_id uuid not null references public.fc_profiles(id),
  employee_code text not null check (employee_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
  performance_month text not null check (performance_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  payment_date date not null,
  genealogy_as_of date not null check (genealogy_as_of <= payment_date),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  policy_version text not null check (policy_version = 'recruitment-2026-09-07-snapshot-pilot-v1'),
  pilot_revision bigint not null check (pilot_revision > 0),
  revision bigint not null check (revision > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 8388608),
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  created_by uuid not null references public.admin_accounts(id),
  created_at timestamptz not null default now(),
  published_by uuid references public.admin_accounts(id),
  published_at timestamptz,
  superseded_at timestamptz,
  unique (beneficiary_fc_id, performance_month, source_sha256, policy_version, pilot_revision),
  unique (beneficiary_fc_id, performance_month, revision),
  check (to_char(payment_date, 'YYYY-MM') = to_char(to_date(performance_month || '-01', 'YYYY-MM-DD') + interval '2 months', 'YYYY-MM')),
  check ((status = 'draft' and published_by is null and published_at is null and superseded_at is null)
    or (status = 'published' and published_by is not null and published_at is not null and superseded_at is null)
    or (status = 'superseded' and published_by is not null and published_at is not null and superseded_at is not null))
);

create unique index if not exists referral_allowance_one_published_month
  on public.referral_allowance_imports (beneficiary_fc_id, performance_month) where status = 'published';
create index if not exists referral_allowance_published_lookup
  on public.referral_allowance_imports (manager_account_id, beneficiary_fc_id, pilot_revision, performance_month desc)
  where status = 'published';

alter table public.referral_allowance_pilot enable row level security;
alter table public.referral_allowance_imports enable row level security;
revoke all on public.referral_allowance_pilot, public.referral_allowance_imports from public, anon, authenticated;
grant select, insert, update on public.referral_allowance_pilot, public.referral_allowance_imports to service_role;

-- The custom signed app session is verified by trusted Edge code; clients have no table/RPC grants.
create or replace function public.referral_allowance_pair_is_valid(p_manager_account_id uuid, p_beneficiary_fc_id uuid)
returns boolean language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.manager_accounts m join public.fc_profiles f
      on regexp_replace(f.phone, '[^0-9]', '', 'g') = regexp_replace(m.phone, '[^0-9]', '', 'g')
    where m.id = p_manager_account_id and m.active = true and f.id = p_beneficiary_fc_id
      and regexp_replace(m.phone, '[^0-9]', '', 'g') ~ '^[0-9]{11}$'
      and (f.signup_completed = true or f.is_manager_referral_shadow = true)
      and position('설계매니저' in coalesce(f.affiliation, '')) = 0
      and not exists (select 1 from public.admin_accounts a
        where regexp_replace(a.phone, '[^0-9]', '', 'g') = regexp_replace(m.phone, '[^0-9]', '', 'g'))
      and (select count(*) from public.fc_profiles other
        where regexp_replace(other.phone, '[^0-9]', '', 'g') = regexp_replace(m.phone, '[^0-9]', '', 'g')) = 1
  );
$$;

create or replace function public.guard_referral_allowance_import_immutability()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if (to_jsonb(new) - array['status','published_by','published_at','superseded_at'])
    is distinct from (to_jsonb(old) - array['status','published_by','published_at','superseded_at']) then
    raise exception using errcode = '23514', message = 'allowance_import_immutable';
  end if;
  if old.status = 'draft' and new.status = 'published' and new.superseded_at is null then return new; end if;
  if old.status = 'published' and new.status = 'superseded'
    and new.published_by is not distinct from old.published_by
    and new.published_at is not distinct from old.published_at then return new; end if;
  raise exception using errcode = '23514', message = 'invalid_allowance_transition';
end;
$$;
drop trigger if exists referral_allowance_import_immutable on public.referral_allowance_imports;
create trigger referral_allowance_import_immutable before update on public.referral_allowance_imports
  for each row execute function public.guard_referral_allowance_import_immutability();

create or replace function public.configure_referral_allowance_pilot(
  p_actor_admin_id uuid, p_manager_account_id uuid, p_beneficiary_fc_id uuid,
  p_employee_code text, p_enabled boolean, p_expected_revision bigint
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_pilot public.referral_allowance_pilot%rowtype;
begin
  if not exists (select 1 from public.admin_accounts where id = p_actor_admin_id and active = true) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  if p_employee_code is null or p_employee_code !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'
    or p_enabled is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_allowance_request';
  end if;
  perform pg_advisory_xact_lock(904920260907::bigint);
  select * into v_pilot from public.referral_allowance_pilot where id = true for update;
  if coalesce(v_pilot.revision, 0) <> p_expected_revision then
    raise exception using errcode = '40001', message = 'allowance_revision_conflict';
  end if;
  -- Revocation of the current pair must remain possible after account deactivation.
  if not coalesce((p_enabled = false and v_pilot.manager_account_id = p_manager_account_id
    and v_pilot.beneficiary_fc_id = p_beneficiary_fc_id and v_pilot.employee_code = p_employee_code), false)
    and not public.referral_allowance_pair_is_valid(p_manager_account_id, p_beneficiary_fc_id) then
    raise exception using errcode = '22023', message = 'invalid_allowance_pilot_pair';
  end if;
  insert into public.referral_allowance_pilot
    (id, manager_account_id, beneficiary_fc_id, employee_code, enabled, revision, updated_by)
  values (true, p_manager_account_id, p_beneficiary_fc_id, p_employee_code, p_enabled, p_expected_revision + 1, p_actor_admin_id)
  on conflict (id) do update set manager_account_id = excluded.manager_account_id,
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
  v_pilot public.referral_allowance_pilot%rowtype;
  v_import public.referral_allowance_imports%rowtype;
  v_count integer;
  v_revision bigint;
begin
  if not exists (select 1 from public.admin_accounts where id = p_actor_admin_id and active = true) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  perform pg_advisory_xact_lock(904920260907::bigint);
  select * into v_pilot from public.referral_allowance_pilot where id = true for update;
  if v_pilot.id is null or v_pilot.enabled is not true
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
  v_pilot public.referral_allowance_pilot%rowtype;
  v_import public.referral_allowance_imports%rowtype;
begin
  if not exists (select 1 from public.admin_accounts where id = p_actor_admin_id and active = true) then
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  perform pg_advisory_xact_lock(904920260907::bigint);
  select * into v_pilot from public.referral_allowance_pilot where id = true for update;
  select * into v_import from public.referral_allowance_imports where id = p_import_id for update;
  if v_pilot.id is null or v_pilot.enabled is not true or v_import.id is null
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
  v_pilot public.referral_allowance_pilot%rowtype;
  v_months jsonb;
  v_snapshot jsonb;
begin
  if p_action is null or p_action not in ('access', 'statement')
    or (p_month is not null and p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$') then
    raise exception using errcode = '22023', message = 'invalid_allowance_request';
  end if;
  select * into v_pilot from public.referral_allowance_pilot where id = true for share;
  if v_pilot.id is null or v_pilot.enabled is not true
    or v_pilot.manager_account_id is distinct from p_manager_account_id
    or v_pilot.beneficiary_fc_id is distinct from p_beneficiary_fc_id
    or not public.referral_allowance_pair_is_valid(p_manager_account_id, p_beneficiary_fc_id) then
    if p_action = 'access' then return jsonb_build_object('ok', true, 'enabled', false); end if;
    raise exception using errcode = '42501', message = 'allowance_forbidden';
  end if;
  select coalesce(jsonb_agg(performance_month order by performance_month desc), '[]'::jsonb) into v_months from (
    select performance_month from public.referral_allowance_imports
    where manager_account_id = v_pilot.manager_account_id and beneficiary_fc_id = v_pilot.beneficiary_fc_id
      and employee_code = v_pilot.employee_code and pilot_revision = v_pilot.revision and status = 'published'
    order by performance_month desc limit 120
  ) months;
  if p_action = 'access' then return jsonb_build_object('ok', true, 'enabled', true, 'availableMonths', v_months); end if;
  select snapshot into v_snapshot from public.referral_allowance_imports
    where manager_account_id = v_pilot.manager_account_id and beneficiary_fc_id = v_pilot.beneficiary_fc_id
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

comment on table public.referral_allowance_pilot is 'One server-controlled manager pilot; no public or signed-in client access.';
comment on table public.referral_allowance_imports is 'Immutable beneficiary-only monthly calculation snapshots; original XLSX files and other beneficiaries are not stored.';
