-- Keep the legacy one-row-per-FC conversation as a compatibility envelope.
-- New clients address a target-specific thread while old clients continue to
-- address the legacy conversation and are routed to the shared admin thread.

create table if not exists public.garamin_direct_threads (
  id uuid primary key default gen_random_uuid(),
  legacy_conversation_id uuid not null
    references public.garamin_direct_conversations(id) on delete cascade,
  counterparty_role text not null
    check (counterparty_role in ('admin', 'manager', 'developer')),
  counterparty_actor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint garamin_direct_threads_counterparty_shape_check check (
    (counterparty_role = 'admin' and counterparty_actor_id is null)
    or
    (counterparty_role in ('manager', 'developer') and counterparty_actor_id is not null)
  ),
  constraint garamin_direct_threads_target_unique
    unique nulls not distinct (
      legacy_conversation_id,
      counterparty_role,
      counterparty_actor_id
    )
);

create index if not exists idx_garamin_direct_threads_counterparty
  on public.garamin_direct_threads (
    counterparty_role,
    counterparty_actor_id,
    legacy_conversation_id
  );

alter table public.garamin_direct_threads enable row level security;
revoke all privileges on table public.garamin_direct_threads
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.garamin_direct_threads
  to service_role;

drop policy if exists "garamin direct threads service role"
  on public.garamin_direct_threads;
create policy "garamin direct threads service role"
  on public.garamin_direct_threads
  for all
  to service_role
  using (true)
  with check (true);

alter table public.messages
  add column if not exists thread_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.messages'::regclass
       and conname = 'messages_thread_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_thread_id_fkey
      foreign key (thread_id)
      references public.garamin_direct_threads(id)
      on delete set null
      not valid;
  end if;
end
$$;

create index if not exists idx_messages_thread_created
  on public.messages (thread_id, created_at);
create index if not exists idx_messages_thread_unread
  on public.messages (thread_id, receiver_id, is_read, created_at);

insert into public.garamin_direct_threads (
  legacy_conversation_id,
  counterparty_role,
  counterparty_actor_id
)
select conversation.id, 'admin', null
  from public.garamin_direct_conversations conversation
on conflict (
  legacy_conversation_id,
  counterparty_role,
  counterparty_actor_id
) do nothing;

update public.messages message
   set thread_id = thread.id
  from public.garamin_direct_threads thread
 where message.thread_id is null
   and message.conversation_id = thread.legacy_conversation_id
   and thread.counterparty_role = 'admin'
   and thread.counterparty_actor_id is null;

-- Replies whose immutable sender actor identifies one exact developer or
-- manager are not ambiguous. Preserve those replies in that actor's personal
-- thread; FC messages addressed only to the old "admin" alias stay shared.
insert into public.garamin_direct_threads (
  legacy_conversation_id,
  counterparty_role,
  counterparty_actor_id
)
select distinct
  message.conversation_id,
  'developer',
  message.sender_actor_id
from public.messages message
join public.garamin_direct_conversations conversation
  on conversation.id = message.conversation_id
join public.admin_accounts account
  on account.id = message.sender_actor_id
 and account.staff_type = 'developer'
where message.sender_actor_id is not null
  and message.receiver_actor_id = conversation.fc_id
on conflict (
  legacy_conversation_id,
  counterparty_role,
  counterparty_actor_id
) do nothing;

insert into public.garamin_direct_threads (
  legacy_conversation_id,
  counterparty_role,
  counterparty_actor_id
)
select distinct
  message.conversation_id,
  'manager',
  message.sender_actor_id
from public.messages message
join public.garamin_direct_conversations conversation
  on conversation.id = message.conversation_id
join public.manager_accounts account
  on account.id = message.sender_actor_id
where message.sender_actor_id is not null
  and message.receiver_actor_id = conversation.fc_id
on conflict (
  legacy_conversation_id,
  counterparty_role,
  counterparty_actor_id
) do nothing;

update public.messages message
   set thread_id = thread.id
  from public.garamin_direct_threads thread
 where message.conversation_id = thread.legacy_conversation_id
   and message.sender_actor_id = thread.counterparty_actor_id
   and thread.counterparty_role in ('developer', 'manager');

create or replace function public.assign_legacy_garamin_direct_thread_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.thread_id is null and new.conversation_id is not null then
    select thread.id
      into new.thread_id
      from public.garamin_direct_threads thread
     where thread.legacy_conversation_id = new.conversation_id
       and thread.counterparty_role = 'admin'
       and thread.counterparty_actor_id is null;
  end if;
  return new;
end;
$$;

revoke all on function public.assign_legacy_garamin_direct_thread_v2()
  from public, anon, authenticated;

drop trigger if exists messages_assign_legacy_direct_thread_v2
  on public.messages;
create trigger messages_assign_legacy_direct_thread_v2
before insert or update of conversation_id, thread_id
on public.messages
for each row
execute function public.assign_legacy_garamin_direct_thread_v2();

create or replace function public.assert_garamin_direct_message_identity_v2(
  p_conversation_id uuid,
  p_sender_id text,
  p_receiver_id text,
  p_sender_actor_id uuid,
  p_receiver_actor_id uuid
)
returns table (
  resolved_thread_id uuid,
  resolved_legacy_conversation_id uuid,
  resolved_fc_id uuid,
  resolved_fc_phone text,
  resolved_counterparty_role text,
  resolved_counterparty_actor_id uuid,
  resolved_counterparty_phone text,
  resolved_sender_role text
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_thread public.garamin_direct_threads%rowtype;
  v_fc_id uuid;
  v_fc_phone text;
  v_counterparty_phone text;
  v_staff_type text;
  v_requested_counterparty_role text;
  v_requested_counterparty_actor_id uuid;
begin
  if p_conversation_id is null
     or p_sender_actor_id is null then
    raise exception 'invalid_direct_message_payload';
  end if;

  select thread.*
    into v_thread
    from public.garamin_direct_threads thread
   where thread.id = p_conversation_id;

  if v_thread.id is null then
    if exists (
      select 1
        from public.admin_accounts account
       where account.id = p_sender_actor_id
         and account.active = true
         and account.staff_type = 'developer'
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_sender_id
    ) then
      v_requested_counterparty_role := 'developer';
      v_requested_counterparty_actor_id := p_sender_actor_id;
    elsif exists (
      select 1
        from public.manager_accounts account
       where account.id = p_sender_actor_id
         and account.active = true
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_sender_id
    ) then
      v_requested_counterparty_role := 'manager';
      v_requested_counterparty_actor_id := p_sender_actor_id;
    else
      v_requested_counterparty_role := 'admin';
      v_requested_counterparty_actor_id := null;
    end if;

    if not exists (
      select 1
        from public.garamin_direct_conversations conversation
       where conversation.id = p_conversation_id
    ) then
      raise exception 'direct_conversation_not_found';
    end if;

    insert into public.garamin_direct_threads (
      legacy_conversation_id,
      counterparty_role,
      counterparty_actor_id
    )
    values (
      p_conversation_id,
      v_requested_counterparty_role,
      v_requested_counterparty_actor_id
    )
    on conflict (
      legacy_conversation_id,
      counterparty_role,
      counterparty_actor_id
    ) do update
      set updated_at = now()
    returning * into v_thread;
  end if;
  if v_thread.id is null then
    raise exception 'direct_conversation_not_found';
  end if;

  select profile.id, regexp_replace(profile.phone, '[^0-9]', '', 'g')
    into v_fc_id, v_fc_phone
    from public.garamin_direct_conversations conversation
    join public.fc_profiles profile
      on profile.id = conversation.fc_id
     and profile.signup_completed = true
     and coalesce(profile.is_manager_referral_shadow, false) = false
     and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
     and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
   where conversation.id = v_thread.legacy_conversation_id;
  if v_fc_id is null or length(v_fc_phone) <> 11 then
    raise exception 'direct_conversation_not_found';
  end if;

  if v_thread.counterparty_role = 'admin' then
    if v_thread.counterparty_actor_id is not null then
      raise exception 'direct_message_identity_mismatch';
    end if;
    v_counterparty_phone := null;
  elsif v_thread.counterparty_role = 'developer' then
    select regexp_replace(account.phone, '[^0-9]', '', 'g'),
           coalesce(account.staff_type, 'admin')
      into v_counterparty_phone, v_staff_type
      from public.admin_accounts account
     where account.id = v_thread.counterparty_actor_id
       and account.active = true
       and account.staff_type = 'developer';
    if not found or length(v_counterparty_phone) <> 11 then
      raise exception 'direct_message_recipient_not_found';
    end if;
  elsif v_thread.counterparty_role = 'manager' then
    select regexp_replace(account.phone, '[^0-9]', '', 'g')
      into v_counterparty_phone
      from public.manager_accounts account
     where account.id = v_thread.counterparty_actor_id
       and account.active = true;
    if not found or length(v_counterparty_phone) <> 11 then
      raise exception 'direct_message_recipient_not_found';
    end if;
  else
    raise exception 'direct_message_identity_mismatch';
  end if;

  if p_sender_id = v_fc_phone and p_sender_actor_id = v_fc_id then
    if v_thread.counterparty_role = 'admin' then
      if p_receiver_id is distinct from 'admin'
         or p_receiver_actor_id is not null
         or not exists (
           select 1
             from public.admin_accounts account
            where account.active = true
              and coalesce(account.staff_type, 'admin') <> 'developer'
         ) then
        raise exception 'direct_message_actor_mismatch';
      end if;
    elsif p_receiver_id is distinct from v_counterparty_phone
       or p_receiver_actor_id is distinct from v_thread.counterparty_actor_id then
      raise exception 'direct_message_actor_mismatch';
    end if;
    resolved_sender_role := 'fc';
  elsif p_receiver_id = v_fc_phone
     and p_receiver_actor_id = v_fc_id then
    if v_thread.counterparty_role = 'admin' then
      if p_sender_id is distinct from 'admin'
         or not exists (
           select 1
             from public.admin_accounts account
            where account.id = p_sender_actor_id
              and account.active = true
              and coalesce(account.staff_type, 'admin') <> 'developer'
         ) then
        raise exception 'direct_message_actor_mismatch';
      end if;
      resolved_sender_role := 'admin';
    elsif v_thread.counterparty_role = 'developer' then
      if p_sender_actor_id is distinct from v_thread.counterparty_actor_id
         or p_sender_id is distinct from v_counterparty_phone then
        raise exception 'direct_message_actor_mismatch';
      end if;
      resolved_sender_role := 'admin';
    else
      if p_sender_actor_id is distinct from v_thread.counterparty_actor_id
         or p_sender_id is distinct from v_counterparty_phone then
        raise exception 'direct_message_actor_mismatch';
      end if;
      resolved_sender_role := 'manager';
    end if;
  else
    raise exception 'direct_message_identity_mismatch';
  end if;

  resolved_thread_id := v_thread.id;
  resolved_legacy_conversation_id := v_thread.legacy_conversation_id;
  resolved_fc_id := v_fc_id;
  resolved_fc_phone := v_fc_phone;
  resolved_counterparty_role := v_thread.counterparty_role;
  resolved_counterparty_actor_id := v_thread.counterparty_actor_id;
  resolved_counterparty_phone := v_counterparty_phone;
  return next;
end;
$$;

revoke all on function public.assert_garamin_direct_message_identity_v2(
  uuid, text, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.assert_garamin_direct_message_identity_v2(
  uuid, text, text, uuid, uuid
) to service_role;

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
  v_identity record;
  v_existing_message public.messages%rowtype;
  v_notification_rows jsonb;
begin
  if p_message_id is null
     or coalesce(length(btrim(p_content)), 0) = 0
     or length(p_content) > 4000 then
    raise exception 'invalid_direct_message_payload';
  end if;

  select *
    into v_identity
    from public.assert_garamin_direct_message_identity_v2(
      p_conversation_id,
      p_sender_id,
      p_receiver_id,
      p_sender_actor_id,
      p_receiver_actor_id
    );

  insert into public.messages (
    id,
    conversation_id,
    thread_id,
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
    v_identity.resolved_legacy_conversation_id,
    v_identity.resolved_thread_id,
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
     or v_existing_message.conversation_id
        is distinct from v_identity.resolved_legacy_conversation_id
     or v_existing_message.thread_id
        is distinct from v_identity.resolved_thread_id
     or v_existing_message.sender_id is distinct from p_sender_id
     or v_existing_message.receiver_id is distinct from p_receiver_id
     or v_existing_message.sender_actor_id is distinct from p_sender_actor_id
     or v_existing_message.receiver_actor_id is distinct from p_receiver_actor_id
     or v_existing_message.content is distinct from p_content
     or v_existing_message.message_type is distinct from 'text' then
    raise exception 'direct_message_idempotency_conflict';
  end if;

  if v_identity.resolved_sender_role = 'fc'
     and v_identity.resolved_counterparty_role = 'admin' then
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      select
        '새 메시지',
        left(p_content, 160),
        'message',
        v_identity.resolved_fc_id,
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
        and coalesce(account.staff_type, 'admin') <> 'developer'
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
  elsif v_identity.resolved_sender_role = 'fc' then
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      values (
        '새 메시지',
        left(p_content, 160),
        'message',
        v_identity.resolved_fc_id,
        v_identity.resolved_counterparty_phone,
        v_identity.resolved_counterparty_actor_id,
        case
          when v_identity.resolved_counterparty_role = 'manager'
            then 'manager'
          else 'admin'
        end,
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':'
          || v_identity.resolved_counterparty_actor_id::text
      )
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning id, resident_id, recipient_actor_id, recipient_role, target
    )
    select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb)
      into v_notification_rows
      from inserted;
  else
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      values (
        '새 메시지',
        left(p_content, 160),
        'message',
        v_identity.resolved_fc_id,
        v_identity.resolved_fc_phone,
        v_identity.resolved_fc_id,
        'fc',
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':'
          || v_identity.resolved_fc_id::text
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

create or replace function public.commit_garamin_direct_message_with_attachments_v2(
  p_message_id uuid,
  p_conversation_id uuid,
  p_sender_id text,
  p_receiver_id text,
  p_sender_actor_id uuid,
  p_receiver_actor_id uuid,
  p_content text,
  p_delivery_key uuid,
  p_payload_fingerprint text,
  p_attachment_intent_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_identity record;
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_existing_message public.messages%rowtype;
  v_attachments jsonb;
  v_notifications jsonb;
  v_notification_ids uuid[];
begin
  if p_message_id is null
     or p_delivery_key is null
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_attachment_intent_ids is null
     or cardinality(p_attachment_intent_ids) not between 1 and 10
     or length(coalesce(p_content, '')) > 4000 then
    raise exception 'invalid_direct_attachment_message';
  end if;

  select *
    into v_identity
    from public.assert_garamin_direct_message_identity_v2(
      p_conversation_id,
      p_sender_id,
      p_receiver_id,
      p_sender_actor_id,
      p_receiver_actor_id
    );

  perform pg_advisory_xact_lock(
    hashtextextended(
      'messenger-direct-thread:' || v_identity.resolved_thread_id::text,
      0
    )
  );

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_sender_actor_id
     and batch.actor_role = v_identity.resolved_sender_role
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.payload_fingerprint is distinct from p_payload_fingerprint
     or v_batch.context_kind <> 'direct'
     or v_batch.conversation_id
        <> v_identity.resolved_legacy_conversation_id then
    raise exception 'attachment_idempotency_conflict';
  end if;
  if (
    select array_agg(intent.id order by intent.sort_order)
      from public.messenger_attachment_upload_intents intent
     where intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation
  ) is distinct from p_attachment_intent_ids then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  if v_batch.status = 'committed' then
    select *
      into v_existing_message
      from public.messages message
     where message.id = p_message_id
       and message.attachment_batch_id = v_batch.id;
    if v_existing_message.id is null
       or v_existing_message.conversation_id
          is distinct from v_identity.resolved_legacy_conversation_id
       or v_existing_message.thread_id
          is distinct from v_identity.resolved_thread_id
       or v_existing_message.sender_actor_id is distinct from p_sender_actor_id
       or v_existing_message.receiver_actor_id is distinct from p_receiver_actor_id
       or v_existing_message.content is distinct from coalesce(p_content, '') then
      raise exception 'attachment_idempotency_conflict';
    end if;
    select coalesce(
      jsonb_agg(to_jsonb(notification) order by notification.id),
      '[]'::jsonb
    )
      into v_notifications
      from public.notifications notification
     where notification.id = any(v_batch.notification_ids);
    return jsonb_build_object(
      'message_id', p_message_id,
      'batch_id', v_batch.id,
      'replayed', true,
      'attachments',
        public.materialize_messenger_attachment_batch_v2(v_batch.id, 1),
      'notifications', v_notifications
    );
  end if;
  if v_batch.status <> 'pending' or v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  v_attachments :=
    public.materialize_messenger_attachment_batch_v2(v_batch.id, 1);

  insert into public.messages (
    id,
    conversation_id,
    thread_id,
    sender_id,
    receiver_id,
    sender_actor_id,
    receiver_actor_id,
    content,
    message_type,
    is_read,
    attachment_batch_id
  )
  values (
    p_message_id,
    v_identity.resolved_legacy_conversation_id,
    v_identity.resolved_thread_id,
    p_sender_id,
    p_receiver_id,
    p_sender_actor_id,
    p_receiver_actor_id,
    coalesce(p_content, ''),
    'file',
    false,
    v_batch.id
  )
  on conflict (id) do nothing;

  select *
    into v_existing_message
    from public.messages message
   where message.id = p_message_id;
  if v_existing_message.id is null
     or v_existing_message.conversation_id
        is distinct from v_identity.resolved_legacy_conversation_id
     or v_existing_message.thread_id
        is distinct from v_identity.resolved_thread_id
     or v_existing_message.sender_actor_id is distinct from p_sender_actor_id
     or v_existing_message.receiver_actor_id is distinct from p_receiver_actor_id
     or v_existing_message.content is distinct from coalesce(p_content, '')
     or v_existing_message.attachment_batch_id <> v_batch.id then
    raise exception 'attachment_idempotency_conflict';
  end if;

  if v_identity.resolved_sender_role = 'fc'
     and v_identity.resolved_counterparty_role = 'admin' then
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      select
        '새 메시지',
        left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
        'message',
        v_identity.resolved_fc_id,
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
        and coalesce(account.staff_type, 'admin') <> 'developer'
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning *
    )
    select coalesce(
             jsonb_agg(to_jsonb(inserted) order by inserted.recipient_actor_id),
             '[]'::jsonb
           ),
           coalesce(
             array_agg(inserted.id order by inserted.recipient_actor_id),
             array[]::uuid[]
           )
      into v_notifications, v_notification_ids
      from inserted;
  elsif v_identity.resolved_sender_role = 'fc' then
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      values (
        '새 메시지',
        left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
        'message',
        v_identity.resolved_fc_id,
        v_identity.resolved_counterparty_phone,
        v_identity.resolved_counterparty_actor_id,
        case
          when v_identity.resolved_counterparty_role = 'manager'
            then 'manager'
          else 'admin'
        end,
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':'
          || v_identity.resolved_counterparty_actor_id::text
      )
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning *
    )
    select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb),
           coalesce(array_agg(inserted.id), array[]::uuid[])
      into v_notifications, v_notification_ids
      from inserted;
  else
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      values (
        '새 메시지',
        left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
        'message',
        v_identity.resolved_fc_id,
        v_identity.resolved_fc_phone,
        v_identity.resolved_fc_id,
        'fc',
        jsonb_build_object(
          'version', 1,
          'kind', 'garamin_direct_chat',
          'conversationId', p_conversation_id
        ),
        '/chat',
        'direct_message:' || p_message_id::text || ':'
          || v_identity.resolved_fc_id::text
      )
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning *
    )
    select coalesce(jsonb_agg(to_jsonb(inserted)), '[]'::jsonb),
           coalesce(array_agg(inserted.id), array[]::uuid[])
      into v_notifications, v_notification_ids
      from inserted;
  end if;

  if cardinality(v_notification_ids) < 1 then
    raise exception 'direct_message_notification_not_persisted';
  end if;

  update public.messenger_attachment_delivery_batches
     set status = 'committed',
         committed_message_ids = array[p_message_id],
         notification_ids = v_notification_ids,
         committed_at = v_now,
         updated_at = v_now
   where id = v_batch.id;

  return jsonb_build_object(
    'message_id', p_message_id,
    'batch_id', v_batch.id,
    'replayed', false,
    'attachments', v_attachments,
    'notifications', v_notifications
  );
end;
$$;

revoke all on function public.commit_garamin_direct_message_with_attachments_v2(
  uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_garamin_direct_message_with_attachments_v2(
  uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid[]
) to service_role;

create or replace function public.commit_garamin_direct_broadcast_with_attachments_v2(
  p_message_ids uuid[],
  p_conversation_ids uuid[],
  p_sender_actor_id uuid,
  p_content text,
  p_delivery_key uuid,
  p_payload_fingerprint text,
  p_attachment_intent_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer := cardinality(p_conversation_ids);
  v_index integer;
  v_requested_id uuid;
  v_thread public.garamin_direct_threads%rowtype;
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_sorted_conversation_ids uuid[];
  v_sender_phone text;
  v_sender_staff_type text;
  v_sender_id text;
  v_thread_ids uuid[] := array[]::uuid[];
  v_legacy_ids uuid[] := array[]::uuid[];
  v_fc_ids uuid[] := array[]::uuid[];
  v_fc_phones text[] := array[]::text[];
  v_fc_id uuid;
  v_fc_phone text;
  v_lock_thread_id uuid;
  v_attachments jsonb;
  v_notifications jsonb;
  v_notification_ids uuid[];
begin
  if p_sender_actor_id is null
     or p_message_ids is null
     or p_conversation_ids is null
     or p_delivery_key is null
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_attachment_intent_ids is null
     or v_count not between 1 and 200
     or cardinality(p_message_ids) <> v_count
     or cardinality(p_attachment_intent_ids) not between 1 and 10
     or length(coalesce(p_content, '')) > 4000
     or cardinality(
       array(select distinct value from unnest(p_conversation_ids) value)
     ) <> v_count
     or cardinality(
       array(select distinct value from unnest(p_message_ids) value)
     ) <> v_count then
    raise exception 'invalid_direct_broadcast_attachment_message';
  end if;

  select regexp_replace(account.phone, '[^0-9]', '', 'g'),
         coalesce(account.staff_type, 'admin')
    into v_sender_phone, v_sender_staff_type
    from public.admin_accounts account
   where account.id = p_sender_actor_id
     and account.active = true
     and coalesce(account.staff_type, 'admin') in ('admin', 'developer');
  if not found or length(v_sender_phone) <> 11 then
    raise exception 'invalid_direct_broadcast_attachment_message';
  end if;
  v_sender_id := case
    when v_sender_staff_type = 'developer' then v_sender_phone
    else 'admin'
  end;

  for v_index in 1..v_count loop
    v_requested_id := p_conversation_ids[v_index];
    v_thread.id := null;

    select thread.*
      into v_thread
      from public.garamin_direct_threads thread
     where thread.id = v_requested_id;
    if v_thread.id is null then
      if not exists (
        select 1
          from public.garamin_direct_conversations conversation
         where conversation.id = v_requested_id
      ) then
        raise exception 'attachment_context_not_found';
      end if;
      insert into public.garamin_direct_threads (
        legacy_conversation_id,
        counterparty_role,
        counterparty_actor_id
      )
      values (
        v_requested_id,
        case
          when v_sender_staff_type = 'developer' then 'developer'
          else 'admin'
        end,
        case
          when v_sender_staff_type = 'developer' then p_sender_actor_id
          else null
        end
      )
      on conflict (
        legacy_conversation_id,
        counterparty_role,
        counterparty_actor_id
      ) do update
        set updated_at = now()
      returning * into v_thread;
    end if;
    if v_thread.id is null then
      raise exception 'attachment_context_not_found';
    end if;

    if v_sender_staff_type = 'developer' then
      if v_thread.counterparty_role <> 'developer'
         or v_thread.counterparty_actor_id is distinct from p_sender_actor_id then
        raise exception 'attachment_context_forbidden';
      end if;
    elsif v_thread.counterparty_role <> 'admin'
       or v_thread.counterparty_actor_id is not null then
      raise exception 'attachment_context_forbidden';
    end if;

    select profile.id, regexp_replace(profile.phone, '[^0-9]', '', 'g')
      into v_fc_id, v_fc_phone
      from public.garamin_direct_conversations conversation
      join public.fc_profiles profile
        on profile.id = conversation.fc_id
       and profile.signup_completed = true
       and coalesce(profile.is_manager_referral_shadow, false) = false
       and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
       and replace(coalesce(profile.affiliation, ''), ' ', '')
           not like '%설계매니저%'
     where conversation.id = v_thread.legacy_conversation_id;
    if v_fc_id is null or length(v_fc_phone) <> 11 then
      raise exception 'attachment_context_not_found';
    end if;

    v_thread_ids := array_append(v_thread_ids, v_thread.id);
    v_legacy_ids :=
      array_append(v_legacy_ids, v_thread.legacy_conversation_id);
    v_fc_ids := array_append(v_fc_ids, v_fc_id);
    v_fc_phones := array_append(v_fc_phones, v_fc_phone);
  end loop;

  if cardinality(
    array(select distinct value from unnest(v_thread_ids) value)
  ) <> v_count then
    raise exception 'invalid_direct_broadcast_attachment_message';
  end if;

  select array_agg(value order by value)
    into v_sorted_conversation_ids
    from unnest(v_legacy_ids) value;

  for v_lock_thread_id in
    select value from unnest(v_thread_ids) value order by value
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'messenger-direct-thread:' || v_lock_thread_id::text,
        0
      )
    );
  end loop;

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_sender_actor_id
     and batch.actor_role = 'admin'
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.payload_fingerprint is distinct from p_payload_fingerprint
     or v_batch.context_kind <> 'direct_broadcast'
     or v_batch.conversation_ids is distinct from v_sorted_conversation_ids then
    raise exception 'attachment_idempotency_conflict';
  end if;
  if (
    select array_agg(intent.id order by intent.sort_order)
      from public.messenger_attachment_upload_intents intent
     where intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation
  ) is distinct from p_attachment_intent_ids then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  if v_batch.status = 'committed' then
    if v_batch.committed_message_ids is distinct from p_message_ids
       or (
         select count(*)
           from unnest(
             p_message_ids,
             v_thread_ids,
             v_legacy_ids
           ) as requested(message_id, thread_id, legacy_id)
           join public.messages message
             on message.id = requested.message_id
            and message.thread_id = requested.thread_id
            and message.conversation_id = requested.legacy_id
          where message.attachment_batch_id = v_batch.id
            and message.sender_actor_id = p_sender_actor_id
            and message.content is not distinct from coalesce(p_content, '')
       ) <> v_count then
      raise exception 'attachment_idempotency_conflict';
    end if;
    select coalesce(
      jsonb_agg(to_jsonb(notification) order by notification.id),
      '[]'::jsonb
    )
      into v_notifications
      from public.notifications notification
     where notification.id = any(v_batch.notification_ids);
    return jsonb_build_object(
      'message_ids', to_jsonb(p_message_ids),
      'batch_id', v_batch.id,
      'replayed', true,
      'attachments',
        public.materialize_messenger_attachment_batch_v2(v_batch.id, v_count),
      'notifications', v_notifications
    );
  end if;
  if v_batch.status <> 'pending' or v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  v_attachments :=
    public.materialize_messenger_attachment_batch_v2(v_batch.id, v_count);

  insert into public.messages (
    id,
    conversation_id,
    thread_id,
    sender_id,
    receiver_id,
    sender_actor_id,
    receiver_actor_id,
    content,
    message_type,
    is_read,
    attachment_batch_id
  )
  select
    requested.message_id,
    requested.legacy_id,
    requested.thread_id,
    v_sender_id,
    requested.fc_phone,
    p_sender_actor_id,
    requested.fc_id,
    coalesce(p_content, ''),
    'file',
    false,
    v_batch.id
  from unnest(
    p_message_ids,
    v_thread_ids,
    v_legacy_ids,
    v_fc_ids,
    v_fc_phones
  ) as requested(message_id, thread_id, legacy_id, fc_id, fc_phone)
  on conflict (id) do nothing;

  if (
    select count(*)
      from unnest(
        p_message_ids,
        v_thread_ids,
        v_legacy_ids
      ) as requested(message_id, thread_id, legacy_id)
      join public.messages message
        on message.id = requested.message_id
       and message.thread_id = requested.thread_id
       and message.conversation_id = requested.legacy_id
     where message.attachment_batch_id = v_batch.id
       and message.sender_actor_id = p_sender_actor_id
       and message.content is not distinct from coalesce(p_content, '')
  ) <> v_count then
    raise exception 'attachment_idempotency_conflict';
  end if;

  with inserted as (
    insert into public.notifications (
      title, body, category, fc_id, resident_id, recipient_actor_id,
      recipient_role, target, target_url, delivery_key
    )
    select
      '새 메시지',
      left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
      'message',
      requested.fc_id,
      requested.fc_phone,
      requested.fc_id,
      'fc',
      jsonb_build_object(
        'version', 1,
        'kind', 'garamin_direct_chat',
        'conversationId', requested.public_conversation_id
      ),
      '/chat',
      'direct_message:' || requested.message_id::text || ':'
        || requested.fc_id::text
    from unnest(
      p_message_ids,
      p_conversation_ids,
      v_fc_ids,
      v_fc_phones
    ) as requested(
      message_id,
      public_conversation_id,
      fc_id,
      fc_phone
    )
    on conflict (delivery_key) do update
      set delivery_key = excluded.delivery_key
    returning *
  )
  select coalesce(
           jsonb_agg(to_jsonb(inserted) order by inserted.id),
           '[]'::jsonb
         ),
         coalesce(
           array_agg(inserted.id order by inserted.id),
           array[]::uuid[]
         )
    into v_notifications, v_notification_ids
    from inserted;
  if cardinality(v_notification_ids) <> v_count then
    raise exception 'direct_message_notification_not_persisted';
  end if;

  update public.messenger_attachment_delivery_batches
     set status = 'committed',
         committed_message_ids = p_message_ids,
         notification_ids = v_notification_ids,
         committed_at = v_now,
         updated_at = v_now
   where id = v_batch.id;

  return jsonb_build_object(
    'message_ids', to_jsonb(p_message_ids),
    'batch_id', v_batch.id,
    'replayed', false,
    'attachments', v_attachments,
    'notifications', v_notifications
  );
end;
$$;

revoke all on function public.commit_garamin_direct_broadcast_with_attachments_v2(
  uuid[], uuid[], uuid, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_garamin_direct_broadcast_with_attachments_v2(
  uuid[], uuid[], uuid, text, uuid, text, uuid[]
) to service_role;

-- Preserve the proven quota/file validation implementation and put a
-- target-aware authorization adapter in front of it. The legacy function
-- stores the one-per-FC envelope in attachment batches; the linked message
-- remains bound to the exact target thread.
alter function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) rename to reserve_messenger_attachment_upload_batch_legacy_v2;

create or replace function public.reserve_messenger_attachment_upload_batch_v2(
  p_actor_id uuid,
  p_actor_role text,
  p_delivery_key uuid,
  p_payload_fingerprint text,
  p_context jsonb,
  p_files jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_kind text := p_context->>'kind';
  v_requested_id uuid;
  v_thread public.garamin_direct_threads%rowtype;
  v_legacy_id uuid;
  v_legacy_ids uuid[] := array[]::uuid[];
  v_requested_ids uuid[];
  v_actor_staff_type text;
  v_requested_counterparty_role text;
  v_requested_counterparty_actor_id uuid;
  v_context jsonb := p_context;
begin
  if v_kind not in ('direct', 'direct_broadcast') then
    return public.reserve_messenger_attachment_upload_batch_legacy_v2(
      p_actor_id,
      p_actor_role,
      p_delivery_key,
      p_payload_fingerprint,
      p_context,
      p_files
    );
  end if;

  if v_kind = 'direct' then
    begin
      v_requested_ids := array[(p_context->>'conversationId')::uuid];
    exception when others then
      raise exception 'invalid_attachment_context';
    end;
  else
    if jsonb_typeof(p_context->'conversationIds') <> 'array'
       or jsonb_array_length(p_context->'conversationIds')
          not between 1 and 200 then
      raise exception 'invalid_attachment_context';
    end if;
    begin
      select array_agg(value::uuid order by value::uuid)
        into v_requested_ids
        from (
          select distinct
            jsonb_array_elements_text(p_context->'conversationIds') as value
        ) requested;
    exception when others then
      raise exception 'invalid_attachment_context';
    end;
    if cardinality(v_requested_ids)
       <> jsonb_array_length(p_context->'conversationIds') then
      raise exception 'invalid_attachment_context';
    end if;
  end if;

  if p_actor_role = 'admin' then
    select coalesce(account.staff_type, 'admin')
      into v_actor_staff_type
      from public.admin_accounts account
     where account.id = p_actor_id
       and account.active = true
       and coalesce(account.staff_type, 'admin') in ('admin', 'developer');
    if not found then
      raise exception 'attachment_context_forbidden';
    end if;
  end if;

  foreach v_requested_id in array v_requested_ids loop
    v_thread.id := null;
    select thread.*
      into v_thread
      from public.garamin_direct_threads thread
     where thread.id = v_requested_id;
    if v_thread.id is null then
      if p_actor_role = 'manager' then
        v_requested_counterparty_role := 'manager';
        v_requested_counterparty_actor_id := p_actor_id;
      elsif p_actor_role = 'admin'
         and v_actor_staff_type = 'developer' then
        v_requested_counterparty_role := 'developer';
        v_requested_counterparty_actor_id := p_actor_id;
      else
        v_requested_counterparty_role := 'admin';
        v_requested_counterparty_actor_id := null;
      end if;
      if not exists (
        select 1
          from public.garamin_direct_conversations conversation
         where conversation.id = v_requested_id
      ) then
        raise exception 'attachment_context_not_found';
      end if;
      insert into public.garamin_direct_threads (
        legacy_conversation_id,
        counterparty_role,
        counterparty_actor_id
      )
      values (
        v_requested_id,
        v_requested_counterparty_role,
        v_requested_counterparty_actor_id
      )
      on conflict (
        legacy_conversation_id,
        counterparty_role,
        counterparty_actor_id
      ) do update
        set updated_at = now()
      returning * into v_thread;
    end if;
    if v_thread.id is null then
      raise exception 'attachment_context_not_found';
    end if;

    if p_actor_role = 'fc' then
      if v_kind <> 'direct'
         or not exists (
           select 1
             from public.garamin_direct_conversations conversation
            where conversation.id = v_thread.legacy_conversation_id
              and conversation.fc_id = p_actor_id
         ) then
        raise exception 'attachment_context_forbidden';
      end if;
    elsif p_actor_role = 'manager' then
      if v_kind <> 'direct'
         or v_thread.counterparty_role <> 'manager'
         or v_thread.counterparty_actor_id is distinct from p_actor_id then
        raise exception 'attachment_context_forbidden';
      end if;
    elsif p_actor_role = 'admin' then
      if v_actor_staff_type = 'developer' then
        if v_thread.counterparty_role <> 'developer'
           or v_thread.counterparty_actor_id is distinct from p_actor_id then
          raise exception 'attachment_context_forbidden';
        end if;
      elsif v_thread.counterparty_role <> 'admin'
         or v_thread.counterparty_actor_id is not null then
        raise exception 'attachment_context_forbidden';
      end if;
    else
      raise exception 'attachment_context_forbidden';
    end if;

    v_legacy_id := v_thread.legacy_conversation_id;
    v_legacy_ids := array_append(v_legacy_ids, v_legacy_id);
  end loop;

  if v_kind = 'direct' then
    v_context := jsonb_build_object(
      'kind', 'direct',
      'conversationId', v_legacy_ids[1]::text
    );
  else
    if cardinality(
      array(select distinct value from unnest(v_legacy_ids) value)
    ) <> cardinality(v_legacy_ids) then
      raise exception 'invalid_attachment_context';
    end if;
    v_context := jsonb_build_object(
      'kind', 'direct_broadcast',
      'conversationIds',
      to_jsonb(array(select value from unnest(v_legacy_ids) value order by value))
    );
  end if;

  return public.reserve_messenger_attachment_upload_batch_legacy_v2(
    p_actor_id,
    p_actor_role,
    p_delivery_key,
    p_payload_fingerprint,
    v_context,
    p_files
  );
end;
$$;

revoke all on function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) to service_role;
