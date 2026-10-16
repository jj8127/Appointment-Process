-- Everything fc-notify needs to check a 1:1 thread, read in one call: the
-- thread, its conversation, the counterparty account rows and the FC profile.
-- fc-notify used to read these in four round trips to the database region.
-- The rows and filters match its separate queries exactly, and fc-notify still
-- makes every access decision from them. Unknown threads return null so the
-- caller can take its legacy-conversation path.

create or replace function public.messenger_direct_thread_snapshot_v1(p_thread_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with thread as (
    select t.id, t.legacy_conversation_id, t.counterparty_role, t.counterparty_actor_id
    from public.garamin_direct_threads t
    where t.id = p_thread_id
  ),
  conversation as (
    select c.id, c.fc_id
    from public.garamin_direct_conversations c
    join thread on thread.legacy_conversation_id = c.id
  ),
  admin_rows as (
    select a.id, a.name, a.phone, a.staff_type, a.active
    from public.admin_accounts a
    cross join thread
    where thread.counterparty_role = 'admin'
      and a.active = true
      and (a.staff_type <> 'developer' or a.staff_type is null)
      and (thread.counterparty_actor_id is null or a.id = thread.counterparty_actor_id)
    limit 1
  ),
  developer_rows as (
    select a.id, a.name, a.phone, a.staff_type, a.active
    from public.admin_accounts a
    cross join thread
    where thread.counterparty_role = 'developer'
      and a.id = thread.counterparty_actor_id
      and a.active = true
      and a.staff_type = 'developer'
  ),
  manager_rows as (
    select m.id, m.name, m.phone, m.active
    from public.manager_accounts m
    cross join thread
    where thread.counterparty_role = 'manager'
      and m.id = thread.counterparty_actor_id
      and m.active = true
  ),
  profile as (
    select p.id, p.phone, p.name, p.affiliation, p.signup_completed, p.is_manager_referral_shadow
    from public.fc_profiles p
    join conversation on conversation.fc_id = p.id
    where p.signup_completed = true
      and p.is_manager_referral_shadow = false
  )
  select case when not exists (select 1 from thread) then null else jsonb_build_object(
    'thread', (select to_jsonb(thread) from thread),
    'conversation', (select to_jsonb(conversation) from conversation),
    'counterparty_rows',
      coalesce((select jsonb_agg(to_jsonb(r)) from admin_rows r), '[]'::jsonb)
      || coalesce((select jsonb_agg(to_jsonb(r)) from developer_rows r), '[]'::jsonb)
      || coalesce((select jsonb_agg(to_jsonb(r)) from manager_rows r), '[]'::jsonb),
    'profile', (select to_jsonb(profile) from profile)
  ) end;
$$;

revoke all on function public.messenger_direct_thread_snapshot_v1(uuid) from public, anon, authenticated;
grant execute on function public.messenger_direct_thread_snapshot_v1(uuid) to service_role;
