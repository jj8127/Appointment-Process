alter table public.notifications
  add column if not exists target_url text;

