alter table public.fc_profiles
  add column if not exists allowance_prescreen_requested_at timestamptz;

comment on column public.fc_profiles.allowance_prescreen_requested_at
  is '총무가 수당동의 사전 심사를 실제로 요청한 시각';

alter table public.fc_profiles
  drop constraint if exists fc_profiles_allowance_flow_requires_date;

alter table public.fc_profiles
  add constraint fc_profiles_allowance_flow_requires_date
  check (
    (allowance_prescreen_requested_at is null or allowance_date is not null)
    and (allowance_reject_reason is null or allowance_date is not null)
    and (status <> 'allowance-consented' or allowance_date is not null)
  );

update public.fc_profiles
set allowance_prescreen_requested_at = null
where allowance_date is null
  and allowance_prescreen_requested_at is not null;

update public.fc_profiles
set allowance_reject_reason = null
where allowance_date is null
  and allowance_reject_reason is not null;

update public.fc_profiles
set status = 'allowance-pending'
where status = 'allowance-consented'
  and allowance_date is null;

alter table public.fc_profiles
  drop constraint if exists fc_profiles_allowance_flow_requires_date;

alter table public.fc_profiles
  add constraint fc_profiles_allowance_flow_requires_date
  check (
    (allowance_prescreen_requested_at is null or allowance_date is not null)
    and (allowance_reject_reason is null or allowance_date is not null)
    and (status <> 'allowance-consented' or allowance_date is not null)
  );
