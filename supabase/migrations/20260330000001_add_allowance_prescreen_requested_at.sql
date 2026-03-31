-- Clean up legacy allowance rows before any later constraint repair.
alter table public.fc_profiles
  add column if not exists allowance_prescreen_requested_at timestamptz;

comment on column public.fc_profiles.allowance_prescreen_requested_at
  is '총무가 수당동의 사전 심사를 실제로 요청한 시각';

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
