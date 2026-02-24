alter table if exists public.board_attachments
  add column if not exists sort_order integer not null default 0;

with ranked as (
  select
    id,
    row_number() over (partition by post_id order by created_at asc, id asc) - 1 as next_sort_order
  from public.board_attachments
)
update public.board_attachments as target
set sort_order = ranked.next_sort_order
from ranked
where ranked.id = target.id;

create index if not exists idx_board_attachments_post_sort
  on public.board_attachments (post_id, sort_order, created_at);
