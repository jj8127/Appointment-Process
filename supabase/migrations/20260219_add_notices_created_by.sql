-- Add created_by column to notices to track who created each notice.
-- This enables managers to edit/delete only their own posts.
alter table public.notices add column if not exists created_by text;
