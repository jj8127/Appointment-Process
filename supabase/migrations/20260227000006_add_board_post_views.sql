-- 게시글 조회수 추적: 게시글-열람자 단위(중복 조회 방지)

create table if not exists public.board_post_views (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.board_posts(id) on delete cascade,
  resident_id text not null,
  role text not null check (role in ('admin','manager','fc')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, resident_id)
);

create index if not exists idx_board_post_views_post
  on public.board_post_views (post_id);

create index if not exists idx_board_post_views_resident
  on public.board_post_views (resident_id);

alter table public.board_post_views enable row level security;

drop policy if exists "board_post_views service_role" on public.board_post_views;
create policy "board_post_views service_role"
  on public.board_post_views
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop trigger if exists trg_board_post_views_updated_at on public.board_post_views;
create trigger trg_board_post_views_updated_at
before update on public.board_post_views
for each row execute function public.set_updated_at();

-- 게시글 통계 뷰에 조회수 포함
create or replace view public.board_post_stats
with (security_invoker = true) as
select
  p.id as post_id,
  count(distinct c.id) as comment_count,
  count(distinct r.id) as reaction_count,
  count(distinct a.id) as attachment_count,
  count(distinct v.id) as view_count
from public.board_posts p
left join public.board_comments c on c.post_id = p.id
left join public.board_post_reactions r on r.post_id = p.id
left join public.board_attachments a on a.post_id = p.id
left join public.board_post_views v on v.post_id = p.id
group by p.id;

create or replace view public.board_posts_with_stats
with (security_invoker = true) as
select
  p.*,
  coalesce(s.comment_count, 0) as comment_count,
  coalesce(s.reaction_count, 0) as reaction_count,
  coalesce(s.attachment_count, 0) as attachment_count,
  coalesce(s.view_count, 0) as view_count
from public.board_posts p
left join public.board_post_stats s on s.post_id = p.id;
