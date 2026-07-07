alter table public.fc_profiles
  add column if not exists license_statuses text[] null;

