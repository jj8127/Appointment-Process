-- Messenger stage 1 fix (found by the 60-round bot run on 2026-10-16): the
-- app clears a 1:1 message's text when it is deleted, but the mirror copied
-- only deleted_at, so the unified copy kept the deleted text (20 rows) and the
-- reconciliation fingerprint no longer matched. A delete now copies the legacy
-- row's text and file fields as they are after the delete, and the rows that
-- already kept deleted text are brought back in line with the legacy tables.

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
             deleted_by_actor_id = public.messenger_actor_for_account(new.deleted_by_actor_id),
             content = coalesce(new.content, ''),
             legacy_file_url = new.file_url,
             legacy_file_name = new.file_name,
             legacy_file_size = new.file_size
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
  begin
    if v_conversation is null then
      -- A group room born after the last backfill: map and fill it whole.
      if tg_op = 'INSERT' and public.messenger_org_by_slug('garam') is not null then
        perform public.messenger_fill_group_room(new.room_id);
      end if;
      return null;
    end if;
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
             deleted_by_actor_id = public.messenger_actor_for_group_key(new.deleted_by_actor_id),
             content = coalesce(new.content, ''),
             legacy_file_url = new.file_url,
             legacy_file_name = new.file_name,
             legacy_file_size = new.file_size
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

revoke all on function public.messenger_mirror_direct_update() from public, anon, authenticated;
grant execute on function public.messenger_mirror_direct_update() to service_role;
revoke all on function public.messenger_mirror_group_message() from public, anon, authenticated;
grant execute on function public.messenger_mirror_group_message() to service_role;

-- Bring rows deleted before this fix in line with the legacy tables.
update public.messenger_messages x
   set content = coalesce(m.content, ''),
       legacy_file_url = m.file_url,
       legacy_file_name = m.file_name,
       legacy_file_size = m.file_size
  from public.messages m
 where m.id = x.id and m.deleted_at is not null
   and (x.content is distinct from coalesce(m.content, '')
        or x.legacy_file_url is distinct from m.file_url
        or x.legacy_file_name is distinct from m.file_name);
update public.messenger_messages x
   set content = coalesce(g.content, ''),
       legacy_file_url = g.file_url,
       legacy_file_name = g.file_name,
       legacy_file_size = g.file_size
  from public.group_chat_messages g
 where g.id = x.id and g.deleted_at is not null
   and (x.content is distinct from coalesce(g.content, '')
        or x.legacy_file_url is distinct from g.file_url
        or x.legacy_file_name is distinct from g.file_name);
