-- Keep direct-message persistence and room-mute enforcement in one database
-- transaction. The preference lookup is deliberately fail-closed for the
-- notification side only: an unreadable/missing preference relation suppresses
-- the notification row, while the already-validated message remains committed.
--
-- The notification INSERTs in the three canonical direct-message RPCs all pass
-- through the trigger below. A transaction-local suppression counter lets the
-- existing RPC integrity checks distinguish an intentionally muted recipient
-- from an unexpected failure to persist an unmuted notification.

alter table public.messenger_attachment_delivery_batches
  add column if not exists notification_expected_count integer not null default 0,
  add column if not exists notification_persisted_count integer not null default 0,
  add column if not exists notification_suppressed_count integer not null default 0;

alter table public.messenger_attachment_delivery_batches
  drop constraint if exists messenger_attachment_delivery_batches_notification_counts_check;
alter table public.messenger_attachment_delivery_batches
  add constraint messenger_attachment_delivery_batches_notification_counts_check
  check (
    notification_expected_count >= 0
    and notification_persisted_count >= 0
    and notification_suppressed_count >= 0
  );

-- Before this migration, committed direct batches were required to persist all
-- notification rows. Preserve that proven result so their idempotent replay can
-- return the same explicit count contract as newly committed muted batches.
update public.messenger_attachment_delivery_batches
   set notification_expected_count = cardinality(notification_ids),
       notification_persisted_count = cardinality(notification_ids),
       notification_suppressed_count = 0
 where context_kind in ('direct', 'direct_broadcast')
   and status = 'committed'
   and notification_expected_count = 0
   and notification_persisted_count = 0
   and notification_suppressed_count = 0;

create or replace function public.garamin_direct_room_notification_allowed_v1(
  p_recipient_actor_id uuid,
  p_recipient_role text,
  p_room_key text
)
returns boolean
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_recipient_actor_id is null
     or p_recipient_role not in ('fc', 'manager', 'admin')
     or p_room_key is null
     or p_room_key !~ '^garamin:direct-thread:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;

  return not exists (
    select 1
      from public.messenger_room_notification_preferences preference
     where preference.actor_id = p_recipient_actor_id
       and preference.actor_role = p_recipient_role
       and preference.room_key = p_room_key
       and preference.muted = true
  );
exception
  -- Preference availability must never reopen notifications. This containment
  -- also preserves the message transaction when the preference schema/read is
  -- temporarily unavailable. No error details are logged because they may
  -- contain identifiers.
  when others then
    return false;
end;
$$;

revoke all on function public.garamin_direct_room_notification_allowed_v1(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.garamin_direct_room_notification_allowed_v1(
  uuid, text, text
) to service_role;

create or replace function public.enforce_garamin_direct_room_mute_on_notification_v1()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_message_id uuid;
  v_thread_id uuid;
  v_suppressed integer;
begin
  if new.category is distinct from 'message'
     or coalesce(new.target ->> 'kind', '') <> 'garamin_direct_chat' then
    return new;
  end if;

  -- Preserve the original idempotent replay result. A notification that was
  -- durably created by an earlier unmuted call is not a new notification and
  -- must remain eligible for the existing ON CONFLICT replay path.
  if exists (
    select 1
      from public.notifications notification
     where notification.delivery_key = new.delivery_key
  ) then
    return new;
  end if;

  begin
    if coalesce(new.delivery_key, '') !~
       '^direct_message:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'direct_notification_delivery_key_unresolved';
    end if;

    v_message_id := split_part(new.delivery_key, ':', 2)::uuid;
    select message.thread_id
      into v_thread_id
      from public.messages message
     where message.id = v_message_id;

    if v_thread_id is null then
      raise exception 'direct_notification_thread_unresolved';
    end if;

    if public.garamin_direct_room_notification_allowed_v1(
      new.recipient_actor_id,
      new.recipient_role,
      'garamin:direct-thread:' || v_thread_id::text
    ) then
      return new;
    end if;
  exception
    -- Any resolution or preference-read failure is notification-fail-closed.
    -- Returning null from a BEFORE INSERT trigger skips only this notification;
    -- the surrounding RPC transaction can still commit its message row.
    when others then
      null;
  end;

  begin
    v_suppressed := coalesce(
      nullif(
        current_setting(
          'app.garamin_direct_room_notifications_suppressed',
          true
        ),
        ''
      )::integer,
      0
    );
  exception
    when others then
      v_suppressed := 0;
  end;

  perform set_config(
    'app.garamin_direct_room_notifications_suppressed',
    (v_suppressed + 1)::text,
    true
  );
  return null;
end;
$$;

revoke all on function public.enforce_garamin_direct_room_mute_on_notification_v1()
  from public, anon, authenticated;
grant execute on function public.enforce_garamin_direct_room_mute_on_notification_v1()
  to service_role;

drop trigger if exists notifications_garamin_direct_room_mute_v1
  on public.notifications;
create trigger notifications_garamin_direct_room_mute_v1
  before insert on public.notifications
  for each row
  execute function public.enforce_garamin_direct_room_mute_on_notification_v1();

-- Patch only the three current service-role RPCs. Each replacement is guarded
-- so a drifted predecessor fails the migration rather than silently shipping a
-- function whose notification integrity check still rolls back muted messages.
do $migration$
declare
  v_definition text;
  v_original text;
  v_step text;
begin
  select pg_get_functiondef(
    'public.send_garamin_direct_message_with_notification(uuid,uuid,text,text,uuid,uuid,text)'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'  v_notification_rows jsonb;\nbegin',
    E'  v_notification_rows jsonb;\n  v_notification_expected_count integer;\n  v_notification_persisted_count integer;\n  v_notification_suppressed_count integer;\nbegin'
  );
  if v_definition = v_original then
    raise exception 'direct_text_notification_count_declaration_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'  if v_identity.resolved_sender_role = \'fc\'\n     and v_identity.resolved_counterparty_role = \'admin\' then',
    E'  if v_identity.resolved_sender_role = \'fc\'\n     and v_identity.resolved_counterparty_role = \'admin\' then\n    select count(*)::integer\n      into v_notification_expected_count\n      from public.admin_accounts account\n     where account.active = true\n       and coalesce(account.staff_type, \'admin\') <> \'developer\';\n  else\n    v_notification_expected_count := 1;\n  end if;\n\n  perform set_config(\'app.garamin_direct_room_notifications_suppressed\', \'0\', true);\n\n  if v_identity.resolved_sender_role = \'fc\'\n     and v_identity.resolved_counterparty_role = \'admin\' then'
  );
  if v_definition = v_step then
    raise exception 'direct_text_room_mute_reset_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'  if jsonb_array_length(coalesce(v_notification_rows, \'[]\'::jsonb)) = 0 then\n    raise exception \'direct_message_notification_not_persisted\';\n  end if;',
    E'  v_notification_persisted_count :=\n    jsonb_array_length(coalesce(v_notification_rows, \'[]\'::jsonb));\n  v_notification_suppressed_count := coalesce(\n    nullif(\n      current_setting(\'app.garamin_direct_room_notifications_suppressed\', true),\n      \'\'\n    )::integer,\n    0\n  );\n  if v_notification_expected_count < 1\n     or v_notification_persisted_count + v_notification_suppressed_count\n        <> v_notification_expected_count then\n    raise exception \'direct_message_notification_not_persisted\';\n  end if;'
  );
  if v_definition = v_step then
    raise exception 'direct_text_room_mute_patch_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'    \'message_id\', p_message_id,\n    \'notifications\', v_notification_rows',
    E'    \'message_id\', p_message_id,\n    \'notification_expected_count\', v_notification_expected_count,\n    \'notification_persisted_count\', v_notification_persisted_count,\n    \'notification_suppressed_count\', v_notification_suppressed_count,\n    \'notifications\', v_notification_rows'
  );
  if v_definition = v_step then
    raise exception 'direct_text_notification_count_return_source_drift';
  end if;
  execute v_definition;

  select pg_get_functiondef(
    'public.commit_garamin_direct_message_with_attachments_v2(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid[])'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'  v_notification_ids uuid[];\nbegin',
    E'  v_notification_ids uuid[];\n  v_notification_expected_count integer;\n  v_notification_persisted_count integer;\n  v_notification_suppressed_count integer;\nbegin'
  );
  if v_definition = v_original then
    raise exception 'direct_attachment_notification_count_declaration_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'     where notification.id = any(v_batch.notification_ids);\n    return jsonb_build_object(',
    E'     where notification.id = any(v_batch.notification_ids);\n    if v_batch.notification_expected_count < 1\n       or v_batch.notification_persisted_count\n          + v_batch.notification_suppressed_count\n          <> v_batch.notification_expected_count\n       or jsonb_array_length(coalesce(v_notifications, \'[]\'::jsonb))\n          <> v_batch.notification_persisted_count then\n      raise exception \'direct_message_notification_not_persisted\';\n    end if;\n    return jsonb_build_object('
  );
  if v_definition = v_step then
    raise exception 'direct_attachment_notification_count_replay_guard_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'      \'replayed\', true,\n      \'attachments\',',
    E'      \'replayed\', true,\n      \'notification_expected_count\', v_batch.notification_expected_count,\n      \'notification_persisted_count\', v_batch.notification_persisted_count,\n      \'notification_suppressed_count\', v_batch.notification_suppressed_count,\n      \'attachments\','
  );
  if v_definition = v_step then
    raise exception 'direct_attachment_notification_count_replay_return_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'  if v_identity.resolved_sender_role = \'fc\'\n     and v_identity.resolved_counterparty_role = \'admin\' then',
    E'  if v_identity.resolved_sender_role = \'fc\'\n     and v_identity.resolved_counterparty_role = \'admin\' then\n    select count(*)::integer\n      into v_notification_expected_count\n      from public.admin_accounts account\n     where account.active = true\n       and coalesce(account.staff_type, \'admin\') <> \'developer\';\n  else\n    v_notification_expected_count := 1;\n  end if;\n\n  perform set_config(\'app.garamin_direct_room_notifications_suppressed\', \'0\', true);\n\n  if v_identity.resolved_sender_role = \'fc\'\n     and v_identity.resolved_counterparty_role = \'admin\' then'
  );
  if v_definition = v_step then
    raise exception 'direct_attachment_room_mute_reset_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'  if cardinality(v_notification_ids) < 1 then\n    raise exception \'direct_message_notification_not_persisted\';\n  end if;',
    E'  v_notification_persisted_count := cardinality(v_notification_ids);\n  v_notification_suppressed_count := coalesce(\n    nullif(\n      current_setting(\'app.garamin_direct_room_notifications_suppressed\', true),\n      \'\'\n    )::integer,\n    0\n  );\n  if v_notification_expected_count < 1\n     or v_notification_persisted_count + v_notification_suppressed_count\n        <> v_notification_expected_count then\n    raise exception \'direct_message_notification_not_persisted\';\n  end if;'
  );
  if v_definition = v_step then
    raise exception 'direct_attachment_room_mute_patch_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'         notification_ids = v_notification_ids,\n         committed_at = v_now,',
    E'         notification_ids = v_notification_ids,\n         notification_expected_count = v_notification_expected_count,\n         notification_persisted_count = v_notification_persisted_count,\n         notification_suppressed_count = v_notification_suppressed_count,\n         committed_at = v_now,'
  );
  if v_definition = v_step then
    raise exception 'direct_attachment_notification_count_store_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'    \'replayed\', false,\n    \'attachments\', v_attachments,',
    E'    \'replayed\', false,\n    \'notification_expected_count\', v_notification_expected_count,\n    \'notification_persisted_count\', v_notification_persisted_count,\n    \'notification_suppressed_count\', v_notification_suppressed_count,\n    \'attachments\', v_attachments,'
  );
  if v_definition = v_step then
    raise exception 'direct_attachment_notification_count_return_source_drift';
  end if;
  execute v_definition;

  select pg_get_functiondef(
    'public.commit_garamin_direct_broadcast_with_attachments_v2(uuid[],uuid[],uuid,text,uuid,text,uuid[])'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'  with inserted as (\n    insert into public.notifications (',
    E'  perform set_config(\'app.garamin_direct_room_notifications_suppressed\', \'0\', true);\n\n  with inserted as (\n    insert into public.notifications ('
  );
  if v_definition = v_original then
    raise exception 'direct_broadcast_room_mute_reset_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'  if cardinality(v_notification_ids) <> v_count then\n    raise exception \'direct_message_notification_not_persisted\';\n  end if;',
    E'  if cardinality(v_notification_ids)\n       + coalesce(nullif(current_setting(\'app.garamin_direct_room_notifications_suppressed\', true), \'\')::integer, 0)\n       <> v_count then\n    raise exception \'direct_message_notification_not_persisted\';\n  end if;'
  );
  if v_definition = v_step then
    raise exception 'direct_broadcast_room_mute_patch_source_drift';
  end if;
  execute v_definition;
end;
$migration$;

-- CREATE OR REPLACE keeps prior ACLs on existing functions, but repeat the
-- boundary explicitly so migration review does not depend on inherited state.
revoke all on function public.send_garamin_direct_message_with_notification(
  uuid, uuid, text, text, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.send_garamin_direct_message_with_notification(
  uuid, uuid, text, text, uuid, uuid, text
) to service_role;

revoke all on function public.commit_garamin_direct_message_with_attachments_v2(
  uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_garamin_direct_message_with_attachments_v2(
  uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid[]
) to service_role;

revoke all on function public.commit_garamin_direct_broadcast_with_attachments_v2(
  uuid[], uuid[], uuid, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_garamin_direct_broadcast_with_attachments_v2(
  uuid[], uuid[], uuid, text, uuid, text, uuid[]
) to service_role;
