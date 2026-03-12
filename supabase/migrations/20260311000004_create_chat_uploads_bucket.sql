begin;

insert into storage.buckets (id, name, public)
values ('chat-uploads', 'chat-uploads', true)
on conflict (id) do update
  set public = excluded.public;

drop policy if exists "chat-uploads write" on storage.objects;
create policy "chat-uploads write"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-uploads'
    and (public.is_admin() or public.is_manager() or public.is_fc())
  );

drop policy if exists "chat-uploads delete" on storage.objects;
create policy "chat-uploads delete"
  on storage.objects for delete
  using (
    bucket_id = 'chat-uploads'
    and (public.is_admin() or public.is_manager() or public.is_fc())
  );

commit;
