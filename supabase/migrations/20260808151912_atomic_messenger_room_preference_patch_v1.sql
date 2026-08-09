begin;

create or replace function public.patch_messenger_room_preference_v1(
  p_actor_id uuid,
  p_actor_role text,
  p_room_key text,
  p_action text,
  p_value boolean default null,
  p_updated_at timestamptz default now()
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_actor_role not in ('fc', 'manager', 'admin') then
    raise exception 'invalid_actor_role';
  end if;
  if p_action not in ('set_room', 'set_room_pinned', 'leave_room') then
    raise exception 'invalid_room_preference_action';
  end if;
  if p_action in ('set_room', 'set_room_pinned') and p_value is null then
    raise exception 'missing_room_preference_value';
  end if;
  if p_room_key !~ '^garamin:(direct-thread|group):[0-9a-f-]{36}$' then
    raise exception 'invalid_room_key';
  end if;

  insert into public.messenger_room_notification_preferences as preference (
    actor_id,
    actor_role,
    room_key,
    muted,
    pinned_at,
    left_at,
    updated_at
  ) values (
    p_actor_id,
    p_actor_role,
    p_room_key,
    case when p_action = 'set_room' then p_value else false end,
    case when p_action = 'set_room_pinned' and p_value then p_updated_at else null end,
    case when p_action = 'leave_room' then p_updated_at else null end,
    p_updated_at
  )
  on conflict (actor_id, actor_role, room_key) do update
  set muted = case
        when p_action = 'set_room' then excluded.muted
        else preference.muted
      end,
      pinned_at = case
        when p_action = 'set_room_pinned' then excluded.pinned_at
        when p_action = 'leave_room' then null
        else preference.pinned_at
      end,
      left_at = case
        when p_action = 'leave_room' then excluded.left_at
        else preference.left_at
      end,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.patch_messenger_room_preference_v1(uuid, text, text, text, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.patch_messenger_room_preference_v1(uuid, text, text, text, boolean, timestamptz)
  to service_role;

comment on function public.patch_messenger_room_preference_v1(uuid, text, text, text, boolean, timestamptz) is
  'Atomically patches one room preference field so mute, pin, and leave watermarks cannot overwrite each other.';

commit;
