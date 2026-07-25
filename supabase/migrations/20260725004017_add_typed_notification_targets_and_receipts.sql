-- Typed notification destinations are a server-owned contract. Legacy target_url
-- remains display-only and is never accepted as an authorization/navigation input.

create or replace function public.is_valid_notification_target_v1(p_target jsonb)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, public
as $$
  select
    jsonb_typeof(p_target) = 'object'
    and p_target->'version' = '1'::jsonb
    and case p_target->>'kind'
      when 'fc_profile' then
        (select array_agg(key order by key) = array['fcId','kind','version']
           from jsonb_object_keys(p_target) key)
        and coalesce(p_target->>'fcId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      when 'onboarding_section' then
        (select array_agg(key order by key) = array['fcId','kind','section','version']
           from jsonb_object_keys(p_target) key)
        and coalesce(p_target->>'fcId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and p_target->>'section' in ('home','consent','docs_upload','hanwha_commission','appointment')
      when 'board_post' then
        (select array_agg(key order by key) = array['kind','postId','version']
           from jsonb_object_keys(p_target) key)
        and coalesce(p_target->>'postId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      when 'notice' then
        (select array_agg(key order by key) = array['kind','noticeId','version']
           from jsonb_object_keys(p_target) key)
        and coalesce(p_target->>'noticeId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      when 'exam' then
        p_target->>'examType' in ('life','nonlife')
        and (
          (
            (select array_agg(key order by key) =
                    array['examRegistrationId','examType','kind','version']
               from jsonb_object_keys(p_target) key)
            and coalesce(p_target->>'examRegistrationId', '') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
          or
          (
            (select array_agg(key order by key) =
                    array['examRoundId','examType','kind','version']
               from jsonb_object_keys(p_target) key)
            and coalesce(p_target->>'examRoundId', '') ~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
        )
      when 'garamin_direct_chat' then
        (select array_agg(key order by key) = array['conversationId','kind','version']
           from jsonb_object_keys(p_target) key)
        and coalesce(p_target->>'conversationId', '') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      when 'group_chat' then
        (select array_agg(key order by key) = array['kind','roomId','version']
           from jsonb_object_keys(p_target) key)
        and coalesce(p_target->>'roomId', '') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      when 'request' then
        (select array_agg(key order by key) = array['kind','requestId','version']
           from jsonb_object_keys(p_target) key)
        and jsonb_typeof(p_target->'requestId') = 'number'
        and (p_target->>'requestId') ~ '^[1-9][0-9]*$'
        and (p_target->>'requestId')::numeric <= 9007199254740991
      when 'request_chat' then
        (select array_agg(key order by key) = array['kind','requestDesignerId','version']
           from jsonb_object_keys(p_target) key)
        and jsonb_typeof(p_target->'requestDesignerId') = 'number'
        and (p_target->>'requestDesignerId') ~ '^[1-9][0-9]*$'
        and (p_target->>'requestDesignerId')::numeric <= 9007199254740991
      when 'request_direct_chat' then
        (select array_agg(key order by key) = array['directConversationId','kind','version']
           from jsonb_object_keys(p_target) key)
        and jsonb_typeof(p_target->'directConversationId') = 'number'
        and (p_target->>'directConversationId') ~ '^[1-9][0-9]*$'
        and (p_target->>'directConversationId')::numeric <= 9007199254740991
      else false
    end;
$$;

revoke all on function public.is_valid_notification_target_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.is_valid_notification_target_v1(jsonb)
  to service_role;

alter table public.notifications
  add column if not exists target jsonb,
  add column if not exists recipient_actor_id uuid,
  add column if not exists delivery_key text;

alter table public.notifications
  drop constraint if exists notifications_target_v1_check;
alter table public.notifications
  add constraint notifications_target_v1_check
  check (target is null or public.is_valid_notification_target_v1(target));
alter table public.notifications
  drop constraint if exists notifications_direct_recipient_actor_check;
alter table public.notifications
  add constraint notifications_direct_recipient_actor_check
  check (resident_id is null or recipient_actor_id is not null)
  not valid;

comment on column public.notifications.target is
  'Strict notification target v1. target_url is legacy display-only.';
comment on column public.notifications.recipient_actor_id is
  'Immutable UUID of an exact recipient. Null means a role-scoped broadcast.';
comment on column public.notifications.delivery_key is
  'Server-owned idempotency key for one domain event and one exact recipient.';

create index if not exists idx_notifications_recipient_actor_created
  on public.notifications (recipient_actor_id, created_at desc);
create index if not exists idx_notifications_target_gin
  on public.notifications using gin (target);
create unique index if not exists idx_notifications_delivery_key_unique
  on public.notifications (delivery_key);

-- Every successful board update, including attachment-order-only updates,
-- advances the committed post version used by notification-only retries.
create or replace function public.update_board_post_atomic(
  p_post_id uuid,
  p_update_category boolean,
  p_category_id uuid,
  p_update_title boolean,
  p_title text,
  p_update_content boolean,
  p_content text,
  p_attachment_order uuid[]
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_current_attachment_count integer;
  v_requested_attachment_count integer;
  v_distinct_attachment_count integer;
begin
  if not exists (select 1 from public.board_posts where id = p_post_id) then
    raise exception 'board post not found' using errcode = 'P0002';
  end if;

  if p_attachment_order is not null then
    select count(*)::integer, count(distinct requested.attachment_id)::integer
      into v_requested_attachment_count, v_distinct_attachment_count
      from unnest(p_attachment_order) as requested(attachment_id);

    select count(*)::integer
      into v_current_attachment_count
      from public.board_attachments
     where post_id = p_post_id;

    if v_requested_attachment_count <> v_distinct_attachment_count
       or v_requested_attachment_count <> v_current_attachment_count then
      raise exception 'attachment order does not match the post' using errcode = '22023';
    end if;

    if exists (
      select 1
        from unnest(p_attachment_order) as requested(attachment_id)
        left join public.board_attachments attachment
          on attachment.id = requested.attachment_id
         and attachment.post_id = p_post_id
       where attachment.id is null
    ) then
      raise exception 'attachment order contains a foreign attachment' using errcode = '22023';
    end if;

    update public.board_attachments attachment
       set sort_order = (requested.position - 1)::integer
      from unnest(p_attachment_order) with ordinality
        as requested(attachment_id, position)
     where attachment.id = requested.attachment_id
       and attachment.post_id = p_post_id;
  end if;

  update public.board_posts
     set category_id = case when p_update_category then p_category_id else category_id end,
         title = case when p_update_title then p_title else title end,
         content = case when p_update_content then p_content else content end,
         edited_at = case
           when p_update_category or p_update_title or p_update_content then now()
           else edited_at
         end,
         updated_at = now()
   where id = p_post_id;
end;
$$;

revoke all on function public.update_board_post_atomic(
  uuid, boolean, uuid, boolean, text, boolean, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.update_board_post_atomic(
  uuid, boolean, uuid, boolean, text, boolean, text, uuid[]
) to service_role;

create table if not exists public.notification_receipts (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  viewer_actor_id uuid not null,
  viewer_role text not null check (viewer_role in ('fc','manager','admin','developer')),
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (notification_id, viewer_actor_id, viewer_role)
);

create index if not exists idx_notification_receipts_viewer_unread
  on public.notification_receipts (viewer_actor_id, viewer_role, notification_id)
  where dismissed_at is null;

alter table public.notification_receipts enable row level security;
revoke all privileges on table public.notification_receipts from public, anon, authenticated;
grant select, insert, update, delete on table public.notification_receipts to service_role;

-- Inbox reads and receipt writes are service-bound through fc-notify. Direct
-- Data API access is intentionally removed even though RLS remains enabled.
drop policy if exists "notifications select" on public.notifications;
drop policy if exists "notifications insert" on public.notifications;
revoke all privileges on table public.notifications from public, anon, authenticated;
grant select, insert, update, delete on table public.notifications to service_role;

create table if not exists public.garamin_direct_conversations (
  id uuid primary key default gen_random_uuid(),
  fc_id uuid not null references public.fc_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fc_id)
);

alter table public.garamin_direct_conversations enable row level security;
revoke all privileges on table public.garamin_direct_conversations from public, anon, authenticated;
grant select, insert, update, delete on table public.garamin_direct_conversations to service_role;

do $$
declare
  v_policy record;
  v_column record;
begin
  if to_regclass('public.messages') is not null then
    execute '
      alter table public.messages
        add column if not exists conversation_id uuid,
        add column if not exists sender_actor_id uuid,
        add column if not exists receiver_actor_id uuid
    ';
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.messages'::regclass
         and conname = 'messages_conversation_id_fkey'
    ) then
      execute '
        alter table public.messages
        add constraint messages_conversation_id_fkey
        foreign key (conversation_id)
        references public.garamin_direct_conversations(id)
        on delete set null
        not valid
      ';
    end if;
    execute '
      create index if not exists idx_messages_conversation_created
      on public.messages (conversation_id, created_at)
    ';
    execute '
      create index if not exists idx_messages_conversation_unread
      on public.messages (conversation_id, receiver_id, is_read, created_at)
    ';

    execute 'alter table public.messages enable row level security';
    execute '
      revoke all privileges on table public.messages
      from public, anon, authenticated, service_role
    ';
    for v_column in
      select column_name
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'messages'
    loop
      execute format(
        'revoke all privileges (%I) on table public.messages from public, anon, authenticated, service_role',
        v_column.column_name
      );
    end loop;
    for v_policy in
      select policyname
        from pg_policies
       where schemaname = 'public'
         and tablename = 'messages'
    loop
      execute format('drop policy if exists %I on public.messages', v_policy.policyname);
    end loop;
    execute '
      create policy "messages service role"
      on public.messages
      for all
      to service_role
      using (true)
      with check (true)
    ';
    execute '
      grant select, insert, update, delete
      on table public.messages
      to service_role
    ';

    -- Only the exact deployed shared-admin sentinel is deterministic. Other
    -- historical staff-phone pairs remain unassigned rather than guessed.
    execute '
      insert into public.garamin_direct_conversations (fc_id)
      select distinct profile.id
        from public.messages message
        join public.fc_profiles profile
          on profile.phone = case
            when message.sender_id = ''admin'' then message.receiver_id
            when message.receiver_id = ''admin'' then message.sender_id
          end
       where (
         (message.sender_id = ''admin'' and message.receiver_id = profile.phone)
         or (message.receiver_id = ''admin'' and message.sender_id = profile.phone)
       )
         and (
           select count(*)
             from public.fc_profiles exact_profile
            where exact_profile.phone = profile.phone
         ) = 1
      on conflict (fc_id) do nothing
    ';
    execute '
      update public.messages message
         set conversation_id = conversation.id
        from public.garamin_direct_conversations conversation
        join public.fc_profiles profile on profile.id = conversation.fc_id
       where message.conversation_id is null
         and (
           (message.sender_id = ''admin'' and message.receiver_id = profile.phone)
           or (message.receiver_id = ''admin'' and message.sender_id = profile.phone)
         )
         and (
           select count(*)
             from public.fc_profiles exact_profile
            where exact_profile.phone = profile.phone
         ) = 1
    ';
  end if;
end
$$;

create or replace function public.send_garamin_direct_message_with_notification(
  p_message_id uuid,
  p_conversation_id uuid,
  p_sender_id text,
  p_receiver_id text,
  p_sender_actor_id uuid,
  p_receiver_actor_id uuid,
  p_content text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_fc_id uuid;
  v_fc_phone text;
  v_existing_message record;
  v_notification_rows jsonb;
begin
  if p_message_id is null
     or p_conversation_id is null
     or p_sender_actor_id is null
     or coalesce(length(btrim(p_content)), 0) = 0
     or length(p_content) > 4000 then
    raise exception 'invalid_direct_message_payload';
  end if;

  select conversation.fc_id, profile.phone
    into v_fc_id, v_fc_phone
    from public.garamin_direct_conversations conversation
    join public.fc_profiles profile on profile.id = conversation.fc_id
   where conversation.id = p_conversation_id
     and profile.signup_completed = true;
  if v_fc_id is null or v_fc_phone is null then
    raise exception 'direct_conversation_not_found';
  end if;

  if p_sender_id = v_fc_phone and p_receiver_id = 'admin' then
    if p_sender_actor_id <> v_fc_id or p_receiver_actor_id is not null then
      raise exception 'direct_message_actor_mismatch';
    end if;
    if not exists (
      select 1 from public.admin_accounts account where account.active = true
    ) then
      raise exception 'direct_message_recipient_not_found';
    end if;
  elsif p_sender_id = 'admin' and p_receiver_id = v_fc_phone then
    if p_receiver_actor_id <> v_fc_id
       or not exists (
         select 1
           from public.admin_accounts account
          where account.id = p_sender_actor_id
            and account.active = true
       ) then
      raise exception 'direct_message_actor_mismatch';
    end if;
  else
    raise exception 'direct_message_identity_mismatch';
  end if;

  insert into public.messages (
    id,
    conversation_id,
    sender_id,
    receiver_id,
    sender_actor_id,
    receiver_actor_id,
    content,
    message_type,
    is_read
  )
  values (
    p_message_id,
    p_conversation_id,
    p_sender_id,
    p_receiver_id,
    p_sender_actor_id,
    p_receiver_actor_id,
    p_content,
    'text',
    false
  )
  on conflict (id) do nothing;

  select message.*
    into v_existing_message
    from public.messages message
   where message.id = p_message_id;
  if v_existing_message.id is null
     or v_existing_message.conversation_id is distinct from p_conversation_id
     or v_existing_message.sender_id is distinct from p_sender_id
     or v_existing_message.receiver_id is distinct from p_receiver_id
     or v_existing_message.sender_actor_id is distinct from p_sender_actor_id
     or v_existing_message.receiver_actor_id is distinct from p_receiver_actor_id
     or v_existing_message.content is distinct from p_content
     or v_existing_message.message_type is distinct from 'text' then
    raise exception 'direct_message_idempotency_conflict';
  end if;

  if p_receiver_id = 'admin' then
    with inserted as (
      insert into public.notifications (
        title,
        body,
        category,
        fc_id,
        resident_id,
        recipient_actor_id,
        recipient_role,
        target,
        target_url,
        delivery_key
      )
      select
        '새 메시지',
        left(p_content, 160),
        'message',
        v_fc_id,
        account.phone,
        account.id,
        'admin',
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':' || account.id::text
      from public.admin_accounts account
      where account.active = true
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning id, resident_id, recipient_actor_id, recipient_role, target
    )
    select coalesce(
      jsonb_agg(to_jsonb(inserted) order by inserted.recipient_actor_id),
      '[]'::jsonb
    )
      into v_notification_rows
      from inserted;
  else
    with inserted as (
      insert into public.notifications (
        title,
        body,
        category,
        fc_id,
        resident_id,
        recipient_actor_id,
        recipient_role,
        target,
        target_url,
        delivery_key
      )
      values (
        '새 메시지',
        left(p_content, 160),
        'message',
        v_fc_id,
        v_fc_phone,
        v_fc_id,
        'fc',
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':' || v_fc_id::text
      )
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning id, resident_id, recipient_actor_id, recipient_role, target
    )
    select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
      into v_notification_rows
      from inserted;
  end if;

  if jsonb_array_length(coalesce(v_notification_rows, '[]'::jsonb)) = 0 then
    raise exception 'direct_message_notification_not_persisted';
  end if;

  return jsonb_build_object(
    'message_id', p_message_id,
    'notifications', v_notification_rows
  );
end;
$$;

revoke all on function public.send_garamin_direct_message_with_notification(
  uuid, uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.send_garamin_direct_message_with_notification(
  uuid, uuid, text, text, uuid, uuid, text
) to service_role;

-- Deterministic legacy backfill only. Duplicate or inactive identity mappings
-- stay null so the service boundary can fail closed.
update public.notifications notification
   set recipient_actor_id = (
     select min(profile.id)
       from public.fc_profiles profile
      where profile.phone = notification.resident_id
        and profile.signup_completed = true
   )
 where notification.recipient_actor_id is null
   and notification.resident_id is not null
   and notification.recipient_role = 'fc'
   and (
     select count(*)
       from public.fc_profiles profile
      where profile.phone = notification.resident_id
        and profile.signup_completed = true
   ) = 1;

update public.notifications notification
   set recipient_actor_id = (
     select min(account.id)
       from public.admin_accounts account
      where account.phone = notification.resident_id
        and account.active = true
   )
 where notification.recipient_actor_id is null
   and notification.resident_id is not null
   and notification.recipient_role = 'admin'
   and (
     select count(*)
       from public.admin_accounts account
      where account.phone = notification.resident_id
        and account.active = true
   ) = 1;

update public.notifications notification
   set recipient_actor_id = (
     select min(account.id)
       from public.manager_accounts account
      where account.phone = notification.resident_id
        and account.active = true
   )
 where notification.recipient_actor_id is null
   and notification.resident_id is not null
   and notification.recipient_role = 'manager'
   and (
     select count(*)
       from public.manager_accounts account
      where account.phone = notification.resident_id
        and account.active = true
   ) = 1;

update public.notifications
   set target = jsonb_build_object(
     'version', 1,
     'kind', 'board_post',
     'postId', substring(target_url from 'postId=([0-9a-fA-F-]{36})$')
   )
 where target is null
   and target_url ~* '^/board\?postId=[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

update public.notifications
   set target = jsonb_build_object(
     'version', 1,
     'kind', 'onboarding_section',
     'fcId', fc_id,
     'section', 'docs_upload'
   )
 where target is null
   and fc_id is not null
   and (
     target_url = '/docs-upload'
     or target_url = '/docs-upload?userId=' || fc_id::text
   );

update public.notifications notification
   set target = jsonb_build_object(
     'version', 1,
     'kind', 'group_chat',
     'roomId', room.id
   )
  from public.group_chat_rooms room
 where notification.target is null
   and notification.target_url = '/group-chat'
   and room.slug = 'general'
   and room.is_active = true;

update public.notifications notification
   set target = jsonb_build_object(
     'version', 1,
     'kind', 'garamin_direct_chat',
     'conversationId', conversation.id
   )
  from public.garamin_direct_conversations conversation
 where notification.target is null
   and notification.category = 'message'
   and notification.fc_id = conversation.fc_id;

drop function if exists public.transition_exam_registration(
  uuid, text, text, uuid, uuid, text
);

create or replace function public.transition_exam_registration(
  p_registration_id uuid,
  p_action text,
  p_actor_type text,
  p_actor_admin_id uuid default null,
  p_actor_fc_id uuid default null,
  p_reason text default null
)
returns table (
  registration_id uuid,
  status text,
  proof_path text,
  target_resident_id text,
  exam_type text,
  notification_id uuid,
  recipient_actor_id uuid
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_registration public.exam_registrations%rowtype;
  v_admin public.admin_accounts%rowtype;
  v_exam_type text;
  v_from_status text;
  v_to_status text;
  v_reason text;
  v_proof_path text;
  v_target_url text;
  v_title text;
  v_body text;
  v_notification_id uuid;
begin
  select registration, round_row.exam_type
    into v_registration, v_exam_type
    from public.exam_registrations registration
    join public.exam_rounds round_row on round_row.id = registration.round_id
   where registration.id = p_registration_id
   for update of registration;

  if v_registration.id is null then
    raise exception using errcode = 'P0002', message = 'exam_registration_not_found';
  end if;
  if v_registration.status in ('completed', 'no_show') then
    raise exception using errcode = '55000', message = 'terminal_exam_registration';
  end if;

  if p_action = 'cancel_by_fc' then
    if p_actor_type <> 'fc'
       or p_actor_fc_id is null
       or p_actor_fc_id <> v_registration.fc_id then
      raise exception using errcode = '42501', message = 'exam_transition_forbidden';
    end if;
  else
    if p_actor_type not in ('admin', 'developer') or p_actor_admin_id is null then
      raise exception using errcode = '42501', message = 'exam_transition_forbidden';
    end if;
    select admin_row.* into v_admin
      from public.admin_accounts admin_row
     where admin_row.id = p_actor_admin_id
       and admin_row.active = true
       and (
         (p_actor_type = 'developer' and admin_row.staff_type = 'developer')
         or (p_actor_type = 'admin' and coalesce(admin_row.staff_type, 'admin') = 'admin')
       )
     for share;
    if v_admin.id is null then
      raise exception using errcode = '42501', message = 'exam_transition_forbidden';
    end if;
  end if;

  v_from_status := v_registration.status;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  case p_action
    when 'confirm' then
      if v_from_status <> 'applied' then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'confirmed';
    when 'unconfirm' then
      if v_from_status <> 'confirmed' then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'applied';
    when 'reject' then
      if v_from_status not in ('applied', 'confirmed') then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      if v_reason is null or char_length(v_reason) > 1000 then
        raise exception using errcode = '22023', message = 'invalid_rejection_reason';
      end if;
      v_to_status := 'rejected';
    when 'cancel_by_fc' then
      if v_from_status <> 'applied' then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'cancelled_by_fc';
    when 'cancel_by_admin' then
      if v_from_status not in ('applied', 'confirmed') then
        raise exception using errcode = '55000', message = 'invalid_exam_transition';
      end if;
      v_to_status := 'cancelled_by_admin';
    else
      raise exception using errcode = '22023', message = 'invalid_exam_transition_action';
  end case;

  if v_to_status in ('cancelled_by_fc', 'cancelled_by_admin') then
    select proof.storage_path into v_proof_path
      from public.exam_payment_proof_uploads proof
     where proof.registration_id = v_registration.id
       and proof.status = 'attached'
     for update;
    update public.exam_payment_proof_uploads proof
       set status = 'discarded'
     where proof.registration_id = v_registration.id
       and proof.status = 'attached';
  end if;

  update public.exam_registrations registration
     set status = v_to_status,
         is_confirmed = v_to_status = 'confirmed',
         payment_proof_attached = case
           when v_to_status in ('cancelled_by_fc', 'cancelled_by_admin') then false
           else registration.payment_proof_attached
         end,
         rejection_reason = case when v_to_status = 'rejected' then v_reason else null end,
         rejected_at = case when v_to_status = 'rejected' then now() else null end,
         rejected_by_admin_id = case when v_to_status = 'rejected' then p_actor_admin_id else null end,
         rejected_by_staff_type = case when v_to_status = 'rejected' then p_actor_type else null end
   where registration.id = v_registration.id;

  insert into public.exam_registration_decision_events (
    registration_id, action, from_status, to_status, reason,
    actor_type, actor_admin_id_snapshot, actor_fc_id_snapshot
  ) values (
    v_registration.id,
    case p_action
      when 'confirm' then 'confirmed'
      when 'unconfirm' then 'unconfirmed'
      when 'reject' then 'rejected'
      when 'cancel_by_fc' then 'cancelled_by_fc'
      when 'cancel_by_admin' then 'cancelled_by_admin'
    end,
    v_from_status,
    v_to_status,
    case when p_action = 'reject' then v_reason else null end,
    p_actor_type,
    p_actor_admin_id,
    p_actor_fc_id
  );

  if p_action <> 'cancel_by_fc' then
    v_target_url := case when v_exam_type = 'nonlife' then '/exam-apply2' else '/exam-apply' end;
    v_title := case p_action
      when 'confirm' then '시험 접수가 승인되었습니다.'
      when 'unconfirm' then '시험 접수 승인이 취소되었습니다.'
      when 'reject' then '시험 접수가 반려되었습니다.'
      else '시험 접수가 취소되었습니다.'
    end;
    v_body := case
      when p_action = 'reject' then v_title || ' 사유: ' || v_reason
      else v_title
    end;
    insert into public.notifications (
      fc_id, resident_id, recipient_role, recipient_actor_id,
      title, body, category, target, target_url
    ) values (
      v_registration.fc_id, v_registration.resident_id, 'fc', v_registration.fc_id,
      v_title, v_body, 'exam_apply',
      jsonb_build_object(
        'version', 1,
        'kind', 'exam',
        'examType', v_exam_type,
        'examRegistrationId', v_registration.id
      ),
      v_target_url
    )
    returning id into v_notification_id;
  end if;

  return query
  select v_registration.id, v_to_status, v_proof_path,
         v_registration.resident_id, v_exam_type, v_notification_id,
         v_registration.fc_id;
end;
$$;

revoke all on function public.transition_exam_registration(
  uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.transition_exam_registration(
  uuid, text, text, uuid, uuid, text
) to service_role;
