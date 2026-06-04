alter table public.fc_profiles
  add column if not exists dawichok_url_sent_at timestamptz;

alter table public.fc_profiles
  add column if not exists dawichok_url_sent_by text;

comment on column public.fc_profiles.dawichok_url_sent_at is
  'Timestamp when an admin marked the Dawichok URL as sent to the FC.';

comment on column public.fc_profiles.dawichok_url_sent_by is
  'Admin phone or resident identifier that marked the Dawichok URL as sent.';
