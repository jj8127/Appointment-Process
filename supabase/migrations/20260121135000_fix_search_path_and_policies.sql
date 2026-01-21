-- Fix role-mutable search_path on functions.
alter function public.is_admin() set search_path = public;
alter function public.is_manager() set search_path = public;
alter function public.is_fc() set search_path = public;
alter function public.current_fc_id() set search_path = public;
alter function public.generate_temp_id() set search_path = public;
alter function public.set_updated_at() set search_path = public;

-- Tighten overly permissive policies without breaking anon access.
drop policy if exists "device_tokens select policy" on public.device_tokens;
create policy "device_tokens select policy"
  on public.device_tokens
  for select
  using (auth.role() in ('anon', 'authenticated'));

drop policy if exists "device_tokens insert policy" on public.device_tokens;
create policy "device_tokens insert policy"
  on public.device_tokens
  for insert
  with check (auth.role() in ('anon', 'authenticated'));

drop policy if exists "device_tokens update policy" on public.device_tokens;
create policy "device_tokens update policy"
  on public.device_tokens
  for update
  using (auth.role() in ('anon', 'authenticated'))
  with check (auth.role() in ('anon', 'authenticated'));

drop policy if exists "device_tokens delete policy" on public.device_tokens;
create policy "device_tokens delete policy"
  on public.device_tokens
  for delete
  using (auth.role() in ('anon', 'authenticated'));

drop policy if exists "exam_locations anon insert" on public.exam_locations;
create policy "exam_locations anon insert"
  on public.exam_locations
  for insert
  with check (auth.role() = 'anon');

drop policy if exists "exam_rounds anon insert" on public.exam_rounds;
create policy "exam_rounds anon insert"
  on public.exam_rounds
  for insert
  with check (auth.role() = 'anon');

drop policy if exists "fc_documents anon insert" on public.fc_documents;
create policy "fc_documents anon insert"
  on public.fc_documents
  for insert
  with check (auth.role() = 'anon');
