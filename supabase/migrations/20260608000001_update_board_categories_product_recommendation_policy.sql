begin;

insert into public.board_categories (name, slug, sort_order, is_active)
values
  ('공지', 'notice', 1, true),
  ('교육 일정', 'education', 2, true),
  ('일반', 'general', 3, true),
  ('상품추천', 'garam-pick', 4, true),
  ('시책', 'policy', 5, true)
on conflict (slug) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

with target as (
  select id
  from public.board_categories
  where slug = 'general'
  limit 1
)
update public.board_posts post
set category_id = target.id
from target, public.board_categories category
where post.category_id = category.id
  and category.slug not in ('notice', 'education', 'general', 'garam-pick', 'policy');

update public.board_categories
set
  is_active = false,
  updated_at = now()
where slug not in ('notice', 'education', 'general', 'garam-pick', 'policy');

commit;
