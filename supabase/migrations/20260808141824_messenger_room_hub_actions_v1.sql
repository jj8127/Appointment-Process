begin;

alter table public.messenger_room_notification_preferences
  add column if not exists pinned_at timestamptz,
  add column if not exists left_at timestamptz;

create index if not exists idx_messenger_room_preferences_pinned
  on public.messenger_room_notification_preferences (actor_id, actor_role, pinned_at desc)
  where pinned_at is not null;

comment on column public.messenger_room_notification_preferences.left_at is
  'Actor-local hub dismissal watermark. The room is visible again after a newer message arrives.';

commit;
