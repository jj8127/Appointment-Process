-- Messenger stage 1 fix: rooms created after the last backfill were not
-- mirrored until the next daily run (found 2026-10-16 when a new FC-developer
-- thread stayed unmapped). The mirror triggers now map such a room on its
-- first message and fill it in time order, so it appears at once. When the
-- people behind the room are not known yet (a brand-new account), the trigger
-- leaves the room to the daily backfill, which creates the people first.

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
  begin
    if v_conversation is null then
      -- A room born after the last backfill: map it and copy it whole.
      if public.messenger_org_by_slug('garam') is null then
        return null;
      end if;
      v_conversation := public.messenger_ensure_direct_thread(new.thread_id);
      if v_conversation is not null then
        perform public.messenger_fill_direct_conversation(v_conversation);
      end if;
      return null;
    end if;
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

revoke all on function public.messenger_mirror_direct_message() from public, anon, authenticated;
grant execute on function public.messenger_mirror_direct_message() to service_role;
revoke all on function public.messenger_mirror_group_message() from public, anon, authenticated;
grant execute on function public.messenger_mirror_group_message() to service_role;
