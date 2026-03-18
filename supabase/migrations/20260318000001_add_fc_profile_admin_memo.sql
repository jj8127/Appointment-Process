-- Keep fc_profiles admin_memo migration paired with schema snapshot updates.
alter table public.fc_profiles
add column if not exists admin_memo text;
