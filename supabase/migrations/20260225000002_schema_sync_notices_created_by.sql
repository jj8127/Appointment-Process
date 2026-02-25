-- Keep schema.sql and migration history synchronized for governance checks.
-- No-op in environments where the column already exists.
alter table public.notices
  add column if not exists created_by text;
