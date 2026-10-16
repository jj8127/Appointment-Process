-- Messenger stage 1: backfill, dual-write triggers, reconciliation and the
-- GaramLink (request board) import entry point.
-- Legacy tables remain the source of truth. Dual-write triggers never raise:
-- a mirroring failure is written to messenger_sync_issues and the legacy write
-- still succeeds. Unmapped rooms are filled by the next messenger_backfill_v1().

create or replace function public.messenger_normalize_phone(p_phone text)
returns text
language sql immutable set search_path = public, pg_temp as $$
  select case
    when regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') ~ '^[0-9]{9,11}$'
      then regexp_replace(p_phone, '[^0-9]', '', 'g')
  end;
$$;

create or replace function public.messenger_actor_for(p_kind text, p_source_id text)
returns uuid
language sql stable set search_path = public, pg_temp as $$
  select actor_id from public.messenger_actor_links
   where source_kind = p_kind and source_id = p_source_id;
$$;

-- Account uuid (fc/admin/manager) -> actor, for legacy *_actor_id columns.
create or replace function public.messenger_actor_for_account(p_account_id uuid)
returns uuid
language sql stable set search_path = public, pg_temp as $$
  select actor_id from public.messenger_actor_links
   where source_id = p_account_id::text and source_kind in ('fc', 'manager', 'admin')
   order by case source_kind when 'fc' then 0 when 'manager' then 1 else 2 end
   limit 1;
$$;

-- Group chat actor key '{role}:{phone}' -> actor.
create or replace function public.messenger_actor_for_group_key(p_key text)
returns uuid
language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_role text := split_part(coalesce(p_key, ''), ':', 1);
  v_phone text := public.messenger_normalize_phone(split_part(coalesce(p_key, ''), ':', 2));
  v_id uuid;
begin
  if v_phone is null then
    return null;
  end if;
  if v_role = 'fc' then
    select id into v_id from public.fc_profiles where phone = v_phone limit 1;
    return public.messenger_actor_for('fc', v_id::text);
  elsif v_role = 'manager' then
    select id into v_id from public.manager_accounts where phone = v_phone;
    return public.messenger_actor_for('manager', v_id::text);
  elsif v_role = 'admin' then
    select id into v_id from public.admin_accounts where phone = v_phone;
    return public.messenger_actor_for('admin', v_id::text);
  end if;
  return null;
end;
$$;

-- Finds or creates the person behind one source account. A new account joins an
-- existing person only when exactly one person already has that phone; two or
-- more candidates are recorded as an issue instead of guessing.
create or replace function public.messenger_ensure_actor(
  p_kind text,
  p_source_id text,
  p_name text,
  p_phone text
) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_actor uuid;
  v_phone text := public.messenger_normalize_phone(p_phone);
  v_candidates uuid[];
begin
  if p_source_id is null then
    return null;
  end if;
  v_actor := public.messenger_actor_for(p_kind, p_source_id);
  if v_actor is not null then
    return v_actor;
  end if;
  if v_phone is not null then
    select array_agg(distinct id) into v_candidates
      from public.messenger_actors where phone = v_phone;
    if cardinality(v_candidates) = 1 then
      v_actor := v_candidates[1];
    elsif cardinality(v_candidates) > 1 then
      insert into public.messenger_sync_issues (source, source_key, reason, detail)
      values ('actor', p_kind || ':' || p_source_id, 'ambiguous_phone',
              jsonb_build_object('candidates', to_jsonb(v_candidates)));
    end if;
  end if;
  if v_actor is null then
    insert into public.messenger_actors (display_name, phone)
    values (coalesce(nullif(trim(p_name), ''), ''), v_phone)
    returning id into v_actor;
  end if;
  insert into public.messenger_actor_links (source_kind, source_id, actor_id)
  values (p_kind, p_source_id, v_actor)
  on conflict (source_kind, source_id) do nothing;
  return public.messenger_actor_for(p_kind, p_source_id);
end;
$$;

create or replace function public.messenger_org_by_slug(p_slug text)
returns uuid
language sql stable set search_path = public, pg_temp as $$
  select id from public.messenger_orgs where slug = p_slug;
$$;

-- Ensures the conversation for one legacy 1:1 thread and maps it.
create or replace function public.messenger_ensure_direct_thread(p_thread_id uuid)
returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_thread record;
  v_fc uuid;
  v_staff uuid;
  v_garam uuid := public.messenger_org_by_slug('garam');
  v_conversation uuid;
  v_key text;
begin
  select conversation_id into v_conversation from public.messenger_legacy_map
   where source_kind = 'garamin_direct_thread' and source_key = p_thread_id::text;
  if found then
    return v_conversation;
  end if;
  select t.id, t.counterparty_role, t.counterparty_actor_id, c.fc_id into v_thread
    from public.garamin_direct_threads t
    join public.garamin_direct_conversations c on c.id = t.legacy_conversation_id
   where t.id = p_thread_id;
  if not found then
    return null;
  end if;
  v_fc := public.messenger_actor_for('fc', v_thread.fc_id::text);
  if v_fc is null then
    insert into public.messenger_sync_issues (source, source_key, reason)
    values ('garamin_direct_thread', p_thread_id::text, 'fc_actor_missing');
    return null;
  end if;

  if v_thread.counterparty_role = 'admin' then
    select id into v_conversation from public.messenger_conversations
     where kind = 'org_room' and owner_org_id = v_garam and subject_actor_id = v_fc;
    if v_conversation is null then
      insert into public.messenger_conversations (kind, owner_org_id, subject_actor_id)
      values ('org_room', v_garam, v_fc) returning id into v_conversation;
    end if;
    insert into public.messenger_conversation_orgs (conversation_id, org_id)
    values (v_conversation, v_garam) on conflict do nothing;
    insert into public.messenger_participants (conversation_id, actor_id, role)
    values (v_conversation, v_fc, 'subject') on conflict do nothing;
  else
    v_staff := public.messenger_actor_for(
      case v_thread.counterparty_role when 'manager' then 'manager' else 'admin' end,
      v_thread.counterparty_actor_id::text
    );
    if v_staff is null then
      insert into public.messenger_sync_issues (source, source_key, reason)
      values ('garamin_direct_thread', p_thread_id::text, 'staff_actor_missing');
      return null;
    end if;
    v_key := least(v_fc::text, v_staff::text) || ':' || greatest(v_fc::text, v_staff::text);
    insert into public.messenger_conversations (kind, direct_key)
    values ('direct', v_key)
    on conflict (direct_key) do update set updated_at = public.messenger_conversations.updated_at
    returning id into v_conversation;
    insert into public.messenger_participants (conversation_id, actor_id)
    values (v_conversation, v_fc), (v_conversation, v_staff) on conflict do nothing;
  end if;

  insert into public.messenger_legacy_map (source_kind, source_key, conversation_id)
  values ('garamin_direct_thread', p_thread_id::text, v_conversation);
  return v_conversation;
end;
$$;

-- The one person with this phone, or null when none or several match.
create or replace function public.messenger_actor_by_phone(p_phone text)
returns uuid
language sql stable set search_path = public, pg_temp as $$
  select case when count(*) = 1 then (array_agg(id))[1] end
    from public.messenger_actors
   where phone = public.messenger_normalize_phone(p_phone);
$$;

-- Sender of one legacy 1:1 message: the account uuid when recorded, otherwise
-- the person with the sender phone ('admin' means the shared Garam inbox).
create or replace function public.messenger_direct_sender(
  p_sender_id text,
  p_sender_actor_id uuid,
  p_fc_actor uuid,
  p_fc_phone text
) returns uuid
language sql stable set search_path = public, pg_temp as $$
  select coalesce(
    public.messenger_actor_for_account(p_sender_actor_id),
    case when public.messenger_normalize_phone(p_sender_id) = public.messenger_normalize_phone(p_fc_phone)
      then p_fc_actor end,
    case when p_sender_id <> 'admin' then public.messenger_actor_by_phone(p_sender_id) end
  );
$$;

-- Legacy 1:1 messages saved without a thread are placed into a conversation by
-- the phones on both sides (decision 2026-10-16). Deleted ones and ones whose
-- other side no longer exists are not moved; they are recorded as issues.
create table if not exists public.messenger_orphan_placements (
  message_id uuid primary key,
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  placed_at timestamptz not null default now()
);
create index if not exists idx_messenger_orphan_placements_conversation
  on public.messenger_orphan_placements (conversation_id);
alter table public.messenger_orphan_placements enable row level security;
revoke all on public.messenger_orphan_placements from public, anon, authenticated;
grant select, insert, update, delete on public.messenger_orphan_placements to service_role;

create or replace function public.messenger_record_orphan_issue(
  p_message_id uuid,
  p_reason text,
  p_detail jsonb default '{}'::jsonb
) returns void
language sql security invoker set search_path = public, pg_temp as $$
  insert into public.messenger_sync_issues (source, source_key, reason, detail)
  select 'messages', p_message_id::text, p_reason, p_detail
   where not exists (
     select 1 from public.messenger_sync_issues
      where source = 'messages' and source_key = p_message_id::text and reason = p_reason
   );
$$;

create or replace function public.messenger_place_orphan_messages()
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  m record;
  v_sender uuid;
  v_receiver uuid;
  v_subject uuid;
  v_conversation uuid;
  v_garam uuid := public.messenger_org_by_slug('garam');
  v_placed integer := 0;
  v_skipped integer := 0;
begin
  for m in
    select l.* from public.messages l
     where l.thread_id is null
       and not exists (select 1 from public.messenger_orphan_placements p where p.message_id = l.id)
     order by l.created_at, l.id
  loop
    if m.deleted_at is not null then
      perform public.messenger_record_orphan_issue(m.id, 'orphan_deleted_skipped');
      v_skipped := v_skipped + 1;
      continue;
    end if;
    v_sender := case when m.sender_id = 'admin' then null
                     else coalesce(public.messenger_actor_for_account(m.sender_actor_id),
                                   public.messenger_actor_by_phone(m.sender_id)) end;
    v_receiver := case when m.receiver_id = 'admin' then null
                       else coalesce(public.messenger_actor_for_account(m.receiver_actor_id),
                                     public.messenger_actor_by_phone(m.receiver_id)) end;
    if (m.sender_id <> 'admin' and v_sender is null)
       or (m.receiver_id <> 'admin' and v_receiver is null)
       or (m.sender_id = 'admin' and m.receiver_id = 'admin') then
      perform public.messenger_record_orphan_issue(m.id, 'orphan_participant_missing',
        jsonb_build_object('senderFound', v_sender is not null or m.sender_id = 'admin',
                           'receiverFound', v_receiver is not null or m.receiver_id = 'admin'));
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if m.sender_id = 'admin' or m.receiver_id = 'admin' then
      v_subject := coalesce(v_sender, v_receiver);
      select id into v_conversation from public.messenger_conversations
       where kind = 'org_room' and owner_org_id = v_garam and subject_actor_id = v_subject;
      if v_conversation is null then
        insert into public.messenger_conversations (kind, owner_org_id, subject_actor_id)
        values ('org_room', v_garam, v_subject) returning id into v_conversation;
      end if;
      insert into public.messenger_conversation_orgs (conversation_id, org_id)
      values (v_conversation, v_garam) on conflict do nothing;
      insert into public.messenger_participants (conversation_id, actor_id, role)
      values (v_conversation, v_subject, 'subject') on conflict do nothing;
    elsif v_sender = v_receiver then
      perform public.messenger_record_orphan_issue(m.id, 'orphan_self_message');
      v_skipped := v_skipped + 1;
      continue;
    else
      insert into public.messenger_conversations (kind, direct_key)
      values ('direct', least(v_sender::text, v_receiver::text) || ':' || greatest(v_sender::text, v_receiver::text))
      on conflict (direct_key) do update set updated_at = public.messenger_conversations.updated_at
      returning id into v_conversation;
      insert into public.messenger_participants (conversation_id, actor_id)
      values (v_conversation, v_sender), (v_conversation, v_receiver) on conflict do nothing;
    end if;
    insert into public.messenger_orphan_placements (message_id, conversation_id)
    values (m.id, v_conversation);
    v_placed := v_placed + 1;
  end loop;
  return jsonb_build_object('placed', v_placed, 'skipped', v_skipped);
end;
$$;

-- Copies every not-yet-mirrored legacy 1:1 message of one conversation (its
-- mapped threads plus placed thread-less messages) in (created_at, id) order,
-- then derives read positions from is_read.
create or replace function public.messenger_fill_direct_conversation(p_conversation_id uuid)
returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_conv public.messenger_conversations%rowtype;
  v_inserted integer := 0;
  v_late integer := 0;
begin
  select * into v_conv from public.messenger_conversations where id = p_conversation_id for update;
  if not found then
    return 0;
  end if;

  select count(*) into v_late
    from public.messages m
   where (m.thread_id::text in (select source_key from public.messenger_legacy_map
                                 where source_kind = 'garamin_direct_thread' and conversation_id = p_conversation_id)
          or m.id in (select message_id from public.messenger_orphan_placements where conversation_id = p_conversation_id))
     and not exists (select 1 from public.messenger_messages x where x.id = m.id)
     and v_conv.last_message_at is not null and m.created_at < v_conv.last_message_at;
  if v_late > 0 then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('messenger_conversation', p_conversation_id::text, 'late_backfill_out_of_order',
            jsonb_build_object('count', v_late));
  end if;

  with src as (
    select m.*,
           coalesce(public.messenger_actor_for_account(m.sender_actor_id),
                    case when m.sender_id <> 'admin' then public.messenger_actor_by_phone(m.sender_id) end) as sender_actor,
           row_number() over (order by m.created_at, m.id) as rn
      from public.messages m
     where (m.thread_id::text in (select source_key from public.messenger_legacy_map
                                   where source_kind = 'garamin_direct_thread' and conversation_id = p_conversation_id)
            or m.id in (select message_id from public.messenger_orphan_placements where conversation_id = p_conversation_id))
       and not exists (select 1 from public.messenger_messages x where x.id = m.id)
  ), ins as (
    insert into public.messenger_messages (
      conversation_id, seq, id, sender_actor_id, sender_org_id, kind, content,
      attachment_batch_id, legacy_file_url, legacy_file_name, legacy_file_size,
      created_at, deleted_at, deleted_by_actor_id
    )
    select p_conversation_id, v_conv.last_event_seq + src.rn, src.id, src.sender_actor,
           case when v_conv.kind = 'org_room' and src.sender_actor is distinct from v_conv.subject_actor_id
             then v_conv.owner_org_id end,
           case when src.message_type in ('text', 'image', 'file') then src.message_type else 'text' end,
           coalesce(src.content, ''), src.attachment_batch_id, src.file_url, src.file_name, src.file_size,
           src.created_at, src.deleted_at, public.messenger_actor_for_account(src.deleted_by_actor_id)
      from src
    returning conversation_id, seq, sender_actor_id, created_at
  ), ev as (
    insert into public.messenger_events (conversation_id, event_seq, type, message_seq, actor_id, created_at)
    select conversation_id, seq, 'message', seq, sender_actor_id, created_at from ins
    returning event_seq
  )
  select count(*) into v_inserted from ev;

  if v_inserted > 0 then
    update public.messenger_conversations c
       set last_event_seq = c.last_event_seq + v_inserted,
           last_message_seq = c.last_event_seq + v_inserted,
           last_message_at = (select max(created_at) from public.messenger_messages where conversation_id = p_conversation_id),
           updated_at = now()
     where c.id = p_conversation_id;
  end if;

  -- Each person read up to the newest message from someone else that the
  -- legacy row marks read; in org rooms the owning org reads the subject's.
  update public.messenger_participants p
     set last_read_seq = greatest(p.last_read_seq, coalesce((
           select max(mm.seq) from public.messenger_messages mm
             join public.messages lm on lm.id = mm.id
            where mm.conversation_id = p_conversation_id and lm.is_read
              and mm.sender_actor_id is distinct from p.actor_id), 0)),
         updated_at = now()
   where p.conversation_id = p_conversation_id and p.role <> 'agent';
  if v_conv.kind = 'org_room' then
    update public.messenger_conversation_orgs co
       set last_read_seq = greatest(co.last_read_seq, coalesce((
             select max(mm.seq) from public.messenger_messages mm
               join public.messages lm on lm.id = mm.id
              where mm.conversation_id = p_conversation_id and lm.is_read
                and mm.sender_actor_id = v_conv.subject_actor_id), 0))
     where co.conversation_id = p_conversation_id and co.org_id = v_conv.owner_org_id;
  end if;
  return v_inserted;
end;
$$;

create or replace function public.messenger_fill_direct_thread(p_thread_id uuid)
returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_conversation uuid := public.messenger_ensure_direct_thread(p_thread_id);
begin
  if v_conversation is null then
    return 0;
  end if;
  return public.messenger_fill_direct_conversation(v_conversation);
end;
$$;

-- Ensures the conversation for one group chat room, its participants and map.
create or replace function public.messenger_ensure_group_room(p_room_id uuid)
returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_room public.group_chat_rooms%rowtype;
  v_garam uuid := public.messenger_org_by_slug('garam');
  v_conversation uuid;
begin
  select conversation_id into v_conversation from public.messenger_legacy_map
   where source_kind = 'group_chat_room' and source_key = p_room_id::text;
  if v_conversation is null then
    select * into v_room from public.group_chat_rooms where id = p_room_id;
    if not found then
      return null;
    end if;
    insert into public.messenger_conversations (kind, owner_org_id, title)
    values ('group', v_garam, v_room.title) returning id into v_conversation;
    insert into public.messenger_legacy_map (source_kind, source_key, conversation_id)
    values ('group_chat_room', p_room_id::text, v_conversation);
  end if;

  -- Same eligibility the group-chat function computes today: approved Garam
  -- members except design managers. FCs need an explicit send permission.
  insert into public.messenger_participants (conversation_id, actor_id, can_send)
  select v_conversation, m.actor_id, m.role <> 'fc'
    from public.messenger_org_members m
   where m.org_id = v_garam and m.status = 'approved'
     and m.role in ('fc', 'manager', 'admin', 'developer')
  on conflict (conversation_id, actor_id) do nothing;

  update public.messenger_participants p
     set can_send = s.can_send_messages, updated_at = now()
    from public.group_chat_member_send_permissions s
   where s.room_id = p_room_id and p.conversation_id = v_conversation
     and p.actor_id = public.messenger_actor_for_group_key(s.actor_id);
  return v_conversation;
end;
$$;

create or replace function public.messenger_fill_group_room(p_room_id uuid)
returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_conversation uuid := public.messenger_ensure_group_room(p_room_id);
  v_conv public.messenger_conversations%rowtype;
  v_inserted integer := 0;
  v_late integer := 0;
begin
  if v_conversation is null then
    return 0;
  end if;
  select * into v_conv from public.messenger_conversations where id = v_conversation for update;

  select count(*) into v_late
    from public.group_chat_messages g
   where g.room_id = p_room_id
     and not exists (select 1 from public.messenger_messages x where x.id = g.id)
     and v_conv.last_message_at is not null and g.created_at < v_conv.last_message_at;
  if v_late > 0 then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('group_chat_room', p_room_id::text, 'late_backfill_out_of_order',
            jsonb_build_object('count', v_late));
  end if;

  with src as (
    select g.*,
           coalesce(public.messenger_actor_for_group_key(g.sender_actor_id),
                    public.messenger_actor_for_group_key(g.sender_role || ':' || g.sender_phone)) as sender_actor,
           row_number() over (order by g.created_at, g.id) as rn
      from public.group_chat_messages g
     where g.room_id = p_room_id
       and not exists (select 1 from public.messenger_messages x where x.id = g.id)
  ), ins as (
    insert into public.messenger_messages (
      conversation_id, seq, id, sender_actor_id, kind, content, attachment_batch_id,
      legacy_file_url, legacy_file_name, legacy_file_size, created_at, deleted_at,
      deleted_by_actor_id
    )
    select v_conversation, v_conv.last_event_seq + src.rn, src.id, src.sender_actor,
           src.message_type, coalesce(src.content, ''), src.attachment_batch_id,
           src.file_url, src.file_name, src.file_size, src.created_at, src.deleted_at,
           public.messenger_actor_for_group_key(src.deleted_by_actor_id)
      from src
    returning conversation_id, seq, sender_actor_id, created_at
  ), ev as (
    insert into public.messenger_events (conversation_id, event_seq, type, message_seq, actor_id, created_at)
    select conversation_id, seq, 'message', seq, sender_actor_id, created_at from ins
    returning event_seq
  )
  select count(*) into v_inserted from ev;

  if v_inserted > 0 then
    update public.messenger_conversations c
       set last_event_seq = c.last_event_seq + v_inserted,
           last_message_seq = c.last_event_seq + v_inserted,
           last_message_at = (select max(created_at) from public.messenger_messages where conversation_id = v_conversation),
           updated_at = now()
     where c.id = v_conversation;
  end if;

  update public.messenger_messages mm
     set reply_to_seq = parent.seq
    from public.group_chat_messages g
    join public.messenger_messages parent on parent.id = g.reply_to_message_id
   where mm.id = g.id and g.room_id = p_room_id and mm.reply_to_seq is null;

  update public.messenger_participants p
     set last_read_seq = greatest(p.last_read_seq, mm.seq), updated_at = now()
    from public.group_chat_reads r
    join public.messenger_messages mm on mm.id = r.last_read_message_id
   where r.room_id = p_room_id and p.conversation_id = v_conversation
     and p.actor_id = public.messenger_actor_for_group_key(r.actor_id);

  insert into public.messenger_reactions (conversation_id, message_seq, actor_id, reaction, created_at, updated_at)
  select v_conversation, mm.seq, public.messenger_actor_for_group_key(r.actor_id), r.reaction, r.created_at, r.updated_at
    from public.group_chat_reactions r
    join public.messenger_messages mm on mm.id = r.message_id
   where r.room_id = p_room_id and public.messenger_actor_for_group_key(r.actor_id) is not null
  on conflict (conversation_id, message_seq, actor_id) do update
    set reaction = excluded.reaction, updated_at = excluded.updated_at;

  update public.messenger_conversations c
     set pinned_notice_seq = mm.seq
    from public.group_chat_notices n
    join public.messenger_messages mm on mm.id = n.message_id
   where n.room_id = p_room_id and c.id = v_conversation;
  return v_inserted;
end;
$$;

-- Applies existing per-room preferences (mute, pin, leave) to participants.
create or replace function public.messenger_apply_room_preferences()
returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_count integer;
begin
  with prefs as (
    select map.conversation_id,
           public.messenger_actor_for(p.actor_role, p.actor_id::text) as actor_id,
           p.muted, p.pinned_at, p.left_at
      from public.messenger_room_notification_preferences p
      join public.messenger_legacy_map map
        on map.source_kind = case split_part(p.room_key, ':', 2)
             when 'direct-thread' then 'garamin_direct_thread'
             when 'group' then 'group_chat_room' end
       and map.source_key = split_part(p.room_key, ':', 3)
  ), upserted as (
    insert into public.messenger_participants (conversation_id, actor_id, role, muted, pinned_at, left_at)
    select conversation_id, actor_id, 'agent', muted, pinned_at, left_at
      from prefs where actor_id is not null
    on conflict (conversation_id, actor_id) do update
      set muted = excluded.muted, pinned_at = excluded.pinned_at,
          left_at = excluded.left_at, updated_at = now()
    returning 1
  )
  select count(*) into v_count from upserted;
  return v_count;
end;
$$;

-- Idempotent full backfill. Safe to re-run: existing links, rooms and messages
-- are kept, and only missing rows are added.
create or replace function public.messenger_backfill_v1()
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  r record;
  v_garam uuid;
  v_direct integer := 0;
  v_group integer := 0;
  v_actor uuid;
  v_orphans jsonb;
begin
  -- 1. People.
  for r in select id, name, phone from public.fc_profiles loop
    perform public.messenger_ensure_actor('fc', r.id::text, r.name, r.phone);
  end loop;
  for r in select id, name, phone from public.admin_accounts loop
    perform public.messenger_ensure_actor('admin', r.id::text, r.name, r.phone);
  end loop;
  for r in select id, name, phone from public.manager_accounts loop
    perform public.messenger_ensure_actor('manager', r.id::text, r.name, r.phone);
  end loop;
  for r in select id, name, phone, fc_id, staff_account_kind, staff_account_id from public.platform_members loop
    v_actor := case
      when r.fc_id is not null then public.messenger_actor_for('fc', r.fc_id::text)
      when r.staff_account_id is not null then public.messenger_actor_for(r.staff_account_kind, r.staff_account_id::text)
    end;
    if v_actor is not null then
      insert into public.messenger_actor_links (source_kind, source_id, actor_id)
      values ('platform_member', r.id::text, v_actor) on conflict do nothing;
    else
      perform public.messenger_ensure_actor('platform_member', r.id::text, r.name, r.phone);
    end if;
  end loop;

  -- 2. Organizations.
  insert into public.messenger_orgs (kind, slug, name) values ('garam', 'garam', '가람')
  on conflict (slug) do nothing;
  insert into public.messenger_orgs (kind, slug, name) values ('moduon_ops', 'moduon-ops', '모두온 운영')
  on conflict (slug) do nothing;
  insert into public.messenger_orgs (kind, partner_id, name, active)
  select 'partner', p.id, p.name, p.active from public.platform_partners p
  on conflict (partner_id) do update set name = excluded.name, active = excluded.active, updated_at = now();
  v_garam := public.messenger_org_by_slug('garam');

  -- 3. Garam memberships (headquarters/team sub-orgs are added by operators).
  insert into public.messenger_org_members (org_id, actor_id, role, status, approved_at)
  select v_garam, public.messenger_actor_for('fc', f.id::text),
         case when f.affiliation like '%설계매니저%' then 'designer' else 'fc' end,
         'approved', now()
    from public.fc_profiles f
   where coalesce(f.signup_completed, false)
     and not coalesce(f.is_manager_referral_shadow, false)
     and f.account_closed_at is null
     and public.messenger_actor_for('fc', f.id::text) is not null
  on conflict do nothing;
  insert into public.messenger_org_members (org_id, actor_id, role, status, approved_at)
  select v_garam, public.messenger_actor_for('manager', m.id::text), 'manager', 'approved', now()
    from public.manager_accounts m where m.active
  on conflict do nothing;
  insert into public.messenger_org_members (org_id, actor_id, role, status, approved_at)
  select v_garam, public.messenger_actor_for('admin', a.id::text), a.staff_type, 'approved', now()
    from public.admin_accounts a where a.active
  on conflict do nothing;

  -- 4. 1:1 rooms: map every thread, place thread-less messages by phone, then
  -- fill each room once so thread and placed messages interleave by time.
  for r in select id from public.garamin_direct_threads order by created_at, id loop
    perform public.messenger_ensure_direct_thread(r.id);
  end loop;
  v_orphans := public.messenger_place_orphan_messages();
  for r in
    select conversation_id from public.messenger_legacy_map where source_kind = 'garamin_direct_thread'
    union
    select conversation_id from public.messenger_orphan_placements
  loop
    v_direct := v_direct + public.messenger_fill_direct_conversation(r.conversation_id);
  end loop;

  -- 5. Group rooms and their messages.
  for r in select id from public.group_chat_rooms order by created_at, id loop
    v_group := v_group + public.messenger_fill_group_room(r.id);
  end loop;

  return jsonb_build_object(
    'actors', (select count(*) from public.messenger_actors),
    'directMessagesAdded', v_direct,
    'orphans', v_orphans,
    'groupMessagesAdded', v_group,
    'preferencesApplied', public.messenger_apply_room_preferences(),
    'openIssues', (select count(*) from public.messenger_sync_issues where resolved_at is null)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Dual-write triggers. Mapped rooms only; failures become sync issues.
-- ---------------------------------------------------------------------------

create or replace function public.messenger_mirror_direct_message()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_conversation uuid;
  v_conv public.messenger_conversations%rowtype;
  v_fc uuid;
  v_fc_phone text;
  v_sender uuid;
  v_seq bigint;
begin
  if new.thread_id is null then
    return null;
  end if;
  select conversation_id into v_conversation from public.messenger_legacy_map
   where source_kind = 'garamin_direct_thread' and source_key = new.thread_id::text;
  if v_conversation is null then
    return null;
  end if;
  begin
    select * into v_conv from public.messenger_conversations where id = v_conversation;
    select public.messenger_actor_for('fc', c.fc_id::text), f.phone into v_fc, v_fc_phone
      from public.garamin_direct_threads t
      join public.garamin_direct_conversations c on c.id = t.legacy_conversation_id
      join public.fc_profiles f on f.id = c.fc_id
     where t.id = new.thread_id;
    v_sender := public.messenger_direct_sender(new.sender_id, new.sender_actor_id, v_fc, v_fc_phone);
    v_seq := public.messenger_append_message(
      v_conversation, new.id, v_sender,
      case when v_conv.kind = 'org_room' and v_sender is distinct from v_fc
        then public.messenger_org_by_slug('garam') end,
      case when new.message_type in ('text', 'image', 'file') then new.message_type else 'text' end,
      new.content, new.created_at, null, new.attachment_batch_id,
      new.file_url, new.file_name, new.file_size, null
    );
  exception when others then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('messages', new.id::text, 'mirror_insert_failed', jsonb_build_object('error', sqlerrm));
  end;
  return null;
end;
$$;

create or replace function public.messenger_mirror_direct_update()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_message public.messenger_messages%rowtype;
  v_conv public.messenger_conversations%rowtype;
begin
  select * into v_message from public.messenger_messages where id = new.id;
  if not found then
    return null;
  end if;
  begin
    select * into v_conv from public.messenger_conversations where id = v_message.conversation_id;
    if new.deleted_at is not null and old.deleted_at is null then
      update public.messenger_messages
         set deleted_at = new.deleted_at,
             deleted_by_actor_id = public.messenger_actor_for_account(new.deleted_by_actor_id)
       where id = new.id;
      perform public.messenger_record_event(v_message.conversation_id, 'delete', v_message.seq,
        public.messenger_actor_for_account(new.deleted_by_actor_id));
    end if;
    -- Legacy read flags move read positions only; stage 2 emits read events.
    if new.is_read and not old.is_read then
      if v_conv.kind = 'org_room' and v_message.sender_actor_id = v_conv.subject_actor_id then
        update public.messenger_conversation_orgs
           set last_read_seq = greatest(last_read_seq, v_message.seq)
         where conversation_id = v_conv.id and org_id = v_conv.owner_org_id;
      else
        update public.messenger_participants
           set last_read_seq = greatest(last_read_seq, v_message.seq), updated_at = now()
         where conversation_id = v_conv.id and role <> 'agent'
           and actor_id is distinct from v_message.sender_actor_id;
      end if;
    end if;
  exception when others then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('messages', new.id::text, 'mirror_update_failed', jsonb_build_object('error', sqlerrm));
  end;
  return null;
end;
$$;

create or replace function public.messenger_mirror_group_message()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_conversation uuid;
  v_seq bigint;
  v_parent bigint;
begin
  select conversation_id into v_conversation from public.messenger_legacy_map
   where source_kind = 'group_chat_room' and source_key = new.room_id::text;
  if v_conversation is null then
    return null;
  end if;
  begin
    if tg_op = 'INSERT' then
      v_seq := public.messenger_append_message(
        v_conversation, new.id,
        coalesce(public.messenger_actor_for_group_key(new.sender_actor_id),
                 public.messenger_actor_for_group_key(new.sender_role || ':' || new.sender_phone)),
        null, new.message_type, new.content, new.created_at, null, new.attachment_batch_id,
        new.file_url, new.file_name, new.file_size, null
      );
      if new.reply_to_message_id is not null then
        select seq into v_parent from public.messenger_messages where id = new.reply_to_message_id;
        update public.messenger_messages set reply_to_seq = v_parent
         where conversation_id = v_conversation and seq = v_seq;
      end if;
    elsif new.deleted_at is not null and old.deleted_at is null then
      update public.messenger_messages
         set deleted_at = new.deleted_at,
             deleted_by_actor_id = public.messenger_actor_for_group_key(new.deleted_by_actor_id)
       where id = new.id
      returning seq into v_seq;
      if v_seq is not null then
        perform public.messenger_record_event(v_conversation, 'delete', v_seq,
          public.messenger_actor_for_group_key(new.deleted_by_actor_id));
      end if;
    end if;
  exception when others then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('group_chat_messages', new.id::text, 'mirror_failed', jsonb_build_object('error', sqlerrm, 'op', tg_op));
  end;
  return null;
end;
$$;

create or replace function public.messenger_mirror_group_read()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    update public.messenger_participants p
       set last_read_seq = greatest(p.last_read_seq, mm.seq), updated_at = now()
      from public.messenger_legacy_map map, public.messenger_messages mm
     where map.source_kind = 'group_chat_room' and map.source_key = new.room_id::text
       and p.conversation_id = map.conversation_id
       and mm.id = new.last_read_message_id
       and p.actor_id = public.messenger_actor_for_group_key(new.actor_id);
  exception when others then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('group_chat_reads', new.room_id::text || ':' || new.actor_id, 'mirror_failed', jsonb_build_object('error', sqlerrm));
  end;
  return null;
end;
$$;

create or replace function public.messenger_mirror_group_reaction()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.group_chat_reactions%rowtype := case when tg_op = 'DELETE' then old else new end;
  v_message public.messenger_messages%rowtype;
  v_actor uuid := public.messenger_actor_for_group_key(v_row.actor_id);
begin
  select * into v_message from public.messenger_messages where id = v_row.message_id;
  if not found or v_actor is null then
    return null;
  end if;
  begin
    if tg_op = 'DELETE' then
      delete from public.messenger_reactions
       where conversation_id = v_message.conversation_id and message_seq = v_message.seq and actor_id = v_actor;
    else
      insert into public.messenger_reactions (conversation_id, message_seq, actor_id, reaction)
      values (v_message.conversation_id, v_message.seq, v_actor, v_row.reaction)
      on conflict (conversation_id, message_seq, actor_id) do update
        set reaction = excluded.reaction, updated_at = now();
    end if;
    perform public.messenger_record_event(v_message.conversation_id, 'reaction', v_message.seq, v_actor,
      jsonb_build_object('reaction', case when tg_op = 'DELETE' then null else v_row.reaction end));
  exception when others then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('group_chat_reactions', v_row.message_id::text, 'mirror_failed', jsonb_build_object('error', sqlerrm));
  end;
  return null;
end;
$$;

create or replace function public.messenger_mirror_group_notice()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_room uuid := case when tg_op = 'DELETE' then old.room_id else new.room_id end;
  v_conversation uuid;
  v_seq bigint;
begin
  select conversation_id into v_conversation from public.messenger_legacy_map
   where source_kind = 'group_chat_room' and source_key = v_room::text;
  if v_conversation is null then
    return null;
  end if;
  begin
    if tg_op <> 'DELETE' then
      select seq into v_seq from public.messenger_messages where id = new.message_id;
    end if;
    update public.messenger_conversations set pinned_notice_seq = v_seq, updated_at = now()
     where id = v_conversation;
    perform public.messenger_record_event(v_conversation, 'notice', v_seq, null);
  exception when others then
    insert into public.messenger_sync_issues (source, source_key, reason, detail)
    values ('group_chat_notices', v_room::text, 'mirror_failed', jsonb_build_object('error', sqlerrm));
  end;
  return null;
end;
$$;

create or replace trigger trg_messenger_mirror_direct_insert
  after insert on public.messages
  for each row execute function public.messenger_mirror_direct_message();
create or replace trigger trg_messenger_mirror_direct_update
  after update of is_read, deleted_at on public.messages
  for each row execute function public.messenger_mirror_direct_update();
create or replace trigger trg_messenger_mirror_group_message
  after insert or update of deleted_at on public.group_chat_messages
  for each row execute function public.messenger_mirror_group_message();
create or replace trigger trg_messenger_mirror_group_read
  after insert or update on public.group_chat_reads
  for each row execute function public.messenger_mirror_group_read();
create or replace trigger trg_messenger_mirror_group_reaction
  after insert or update or delete on public.group_chat_reactions
  for each row execute function public.messenger_mirror_group_reaction();
create or replace trigger trg_messenger_mirror_group_notice
  after insert or update or delete on public.group_chat_notices
  for each row execute function public.messenger_mirror_group_notice();

-- ---------------------------------------------------------------------------
-- Reconciliation: legacy vs unified, per mapped room. Records one run row.
-- ---------------------------------------------------------------------------

create or replace function public.messenger_reconcile_v1()
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_result jsonb;
  v_ok boolean;
begin
  with direct_rows as (
    select map.conversation_id, m.id, m.content, m.deleted_at
      from public.messenger_legacy_map map
      join public.messages m on m.thread_id::text = map.source_key
     where map.source_kind = 'garamin_direct_thread'
    union
    select p.conversation_id, m.id, m.content, m.deleted_at
      from public.messenger_orphan_placements p
      join public.messages m on m.id = p.message_id
  ), direct_legacy as (
    select conversation_id, count(*) as n,
           md5(string_agg(id::text || '|' || md5(coalesce(content, '')) || '|' || coalesce(deleted_at::text, ''), ',' order by id)) as fp
      from direct_rows
     group by conversation_id
  ), group_legacy as (
    select map.conversation_id, count(*) as n,
           md5(string_agg(g.id::text || '|' || md5(coalesce(g.content, '')) || '|' || coalesce(g.deleted_at::text, ''), ',' order by g.id)) as fp
      from public.messenger_legacy_map map
      join public.group_chat_messages g on g.room_id::text = map.source_key
     where map.source_kind = 'group_chat_room'
     group by map.conversation_id
  ), legacy as (
    select * from direct_legacy union all select * from group_legacy
  ), unified as (
    select mm.conversation_id, count(*) as n,
           md5(string_agg(mm.id::text || '|' || md5(mm.content) || '|' || coalesce(mm.deleted_at::text, ''), ',' order by mm.id)) as fp
      from public.messenger_messages mm
     where mm.conversation_id in (select conversation_id from legacy)
     group by mm.conversation_id
  ), diff as (
    select l.conversation_id, l.n as legacy_count, coalesce(u.n, 0) as unified_count
      from legacy l left join unified u on u.conversation_id = l.conversation_id
     where u.fp is distinct from l.fp
  )
  select jsonb_build_object(
    'mismatchedRooms', (select count(*) from diff),
    'mismatchSample', coalesce((select jsonb_agg(to_jsonb(d)) from (select * from diff limit 20) d), '[]'::jsonb),
    'unmappedDirectThreads', (select count(*) from public.garamin_direct_threads t
                               where not exists (select 1 from public.messenger_legacy_map map
                                                  where map.source_kind = 'garamin_direct_thread' and map.source_key = t.id::text)),
    'unmappedGroupRooms', (select count(*) from public.group_chat_rooms r
                            where not exists (select 1 from public.messenger_legacy_map map
                                               where map.source_kind = 'group_chat_room' and map.source_key = r.id::text)),
    'unhandledOrphanMessages', (select count(*) from public.messages m
                                 where m.thread_id is null
                                   and not exists (select 1 from public.messenger_orphan_placements p where p.message_id = m.id)
                                   and not exists (select 1 from public.messenger_sync_issues i
                                                    where i.source = 'messages' and i.source_key = m.id::text
                                                      and i.reason in ('orphan_deleted_skipped', 'orphan_participant_missing'))),
    'skippedOrphanMessages', (select count(distinct source_key) from public.messenger_sync_issues
                               where source = 'messages' and reason in ('orphan_deleted_skipped', 'orphan_participant_missing')),
    'unlinkedAccounts', (select count(*) from (
        select 'fc' k, id::text s from public.fc_profiles
        union all select 'admin', id::text from public.admin_accounts
        union all select 'manager', id::text from public.manager_accounts) a
      where not exists (select 1 from public.messenger_actor_links l where l.source_kind = a.k and l.source_id = a.s)),
    'openIssues', (select count(*) from public.messenger_sync_issues
                    where resolved_at is null
                      and reason not in ('orphan_deleted_skipped', 'orphan_participant_missing'))
  ) into v_result;

  v_ok := (v_result->>'mismatchedRooms')::int = 0
      and (v_result->>'unmappedDirectThreads')::int = 0
      and (v_result->>'unmappedGroupRooms')::int = 0
      and (v_result->>'unhandledOrphanMessages')::int = 0
      and (v_result->>'unlinkedAccounts')::int = 0;
  insert into public.messenger_reconcile_runs (ok, result) values (v_ok, v_result);
  return v_result || jsonb_build_object('ok', v_ok);
end;
$$;

-- ---------------------------------------------------------------------------
-- GaramLink import. The request board lives in another database, so its server
-- exports batches in this shape (oldest first; later batches only carry newer
-- rows):
-- {"users":[{"id":1,"phone":"010...","name":"..."}],
--  "messages":[{"source":"request"|"direct","id":7,"senderUserId":1,
--               "peerUserId":2,"requestId":3,"directConversationId":null,
--               "content":"...","createdAt":"...","isRead":true}]}
-- One room per pair of people (decision 2026-10-16); request messages carry
-- {"requestBoard":{"requestId":n}} in context. Attachments follow separately.
-- ---------------------------------------------------------------------------

create or replace function public.messenger_import_request_board_v1(p_payload jsonb)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  u jsonb;
  m jsonb;
  v_sender uuid;
  v_peer uuid;
  v_key text;
  v_conversation uuid;
  v_id uuid;
  v_users integer := 0;
  v_messages integer := 0;
  v_source_kind text;
  v_source_key text;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload';
  end if;
  for u in select * from jsonb_array_elements(coalesce(p_payload->'users', '[]'::jsonb)) loop
    perform public.messenger_ensure_actor('request_board_user', u->>'id', u->>'name', u->>'phone');
    v_users := v_users + 1;
  end loop;

  for m in
    select value from jsonb_array_elements(coalesce(p_payload->'messages', '[]'::jsonb))
     order by (value->>'createdAt')::timestamptz, value->>'source', (value->>'id')::bigint
  loop
    v_sender := public.messenger_actor_for('request_board_user', m->>'senderUserId');
    v_peer := public.messenger_actor_for('request_board_user', m->>'peerUserId');
    if v_sender is null or v_peer is null or v_sender = v_peer then
      insert into public.messenger_sync_issues (source, source_key, reason)
      values ('request_board', (m->>'source') || ':' || (m->>'id'), 'participant_missing');
      continue;
    end if;
    v_key := least(v_sender::text, v_peer::text) || ':' || greatest(v_sender::text, v_peer::text);
    insert into public.messenger_conversations (kind, direct_key)
    values ('direct', v_key)
    on conflict (direct_key) do update set updated_at = public.messenger_conversations.updated_at
    returning id into v_conversation;
    insert into public.messenger_participants (conversation_id, actor_id)
    values (v_conversation, v_sender), (v_conversation, v_peer) on conflict do nothing;

    if m->>'source' = 'direct' then
      v_source_kind := 'request_board_direct';
      v_source_key := m->>'directConversationId';
    else
      v_source_kind := 'request_board_pair';
      v_source_key := least((m->>'senderUserId')::bigint, (m->>'peerUserId')::bigint) || ':'
                   || greatest((m->>'senderUserId')::bigint, (m->>'peerUserId')::bigint);
    end if;
    if v_source_key is not null then
      insert into public.messenger_legacy_map (source_kind, source_key, conversation_id)
      values (v_source_kind, v_source_key, v_conversation) on conflict do nothing;
    end if;

    v_id := md5('request_board:' || (m->>'source') || ':' || (m->>'id'))::uuid;
    perform public.messenger_append_message(
      v_conversation, v_id, v_sender, null, 'text', m->>'content', (m->>'createdAt')::timestamptz,
      case when m->>'requestId' is not null
        then jsonb_build_object('requestBoard', jsonb_build_object('requestId', (m->>'requestId')::bigint)) end
    );
    if coalesce((m->>'isRead')::boolean, false) then
      update public.messenger_participants p
         set last_read_seq = greatest(p.last_read_seq, mm.seq), updated_at = now()
        from public.messenger_messages mm
       where mm.id = v_id and p.conversation_id = v_conversation and p.actor_id = v_peer;
    end if;
    v_messages := v_messages + 1;
  end loop;
  return jsonb_build_object('users', v_users, 'messages', v_messages);
end;
$$;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'messenger_normalize_phone', 'messenger_actor_for', 'messenger_actor_for_account',
         'messenger_actor_for_group_key', 'messenger_ensure_actor', 'messenger_org_by_slug',
         'messenger_ensure_direct_thread', 'messenger_direct_sender', 'messenger_fill_direct_thread',
         'messenger_actor_by_phone', 'messenger_record_orphan_issue', 'messenger_place_orphan_messages',
         'messenger_fill_direct_conversation',
         'messenger_ensure_group_room', 'messenger_fill_group_room', 'messenger_apply_room_preferences',
         'messenger_backfill_v1', 'messenger_mirror_direct_message', 'messenger_mirror_direct_update',
         'messenger_mirror_group_message', 'messenger_mirror_group_read', 'messenger_mirror_group_reaction',
         'messenger_mirror_group_notice', 'messenger_reconcile_v1', 'messenger_import_request_board_v1'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end;
$$;
