-- Ensure RLS is enabled on tables exposed via PostgREST or with existing policies.
alter table if exists public.exam_locations enable row level security;
alter table if exists public.exam_registrations enable row level security;
alter table if exists public.fc_documents enable row level security;
alter table if exists public.exam_rounds enable row level security;
alter table if exists public.fc_profiles enable row level security;
alter table if exists public.manager_accounts enable row level security;

-- Ensure views run with invoker security so RLS applies to querying users.
alter view if exists public.board_post_stats set (security_invoker = true);
alter view if exists public.board_comment_stats set (security_invoker = true);
alter view if exists public.board_posts_with_stats set (security_invoker = true);
alter view if exists public.board_comments_with_stats set (security_invoker = true);
