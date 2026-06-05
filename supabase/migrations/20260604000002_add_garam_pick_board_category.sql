insert into public.board_categories (name, slug, sort_order, is_active)
values ('가람pick', 'garam-pick', 4, true)
on conflict (slug) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();
