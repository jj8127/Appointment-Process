-- GaramIn direct-message targets now bind plain administrators to an exact
-- active actor. The nullable admin tuple remains only for legacy shared-room
-- compatibility; new callers use the non-null actor tuple.

alter table public.garamin_direct_threads
  drop constraint if exists garamin_direct_threads_counterparty_shape_check;

alter table public.garamin_direct_threads
  add constraint garamin_direct_threads_counterparty_shape_check check (
    counterparty_role = 'admin'
    or (
      counterparty_role in ('manager', 'developer')
      and counterparty_actor_id is not null
    )
  );

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
  v_requested_counterparty_role text;
  v_requested_counterparty_actor_id uuid;
begin
  if p_conversation_id is null or p_sender_actor_id is null then
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
        from public.admin_accounts account
       where account.id = p_sender_actor_id
         and account.active = true
         and coalesce(account.staff_type, 'admin') <> 'developer'
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_sender_id
    ) then
      v_requested_counterparty_role := 'admin';
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
    elsif exists (
      select 1
        from public.admin_accounts account
       where account.id = p_receiver_actor_id
         and account.active = true
         and account.staff_type = 'developer'
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_receiver_id
    ) then
      v_requested_counterparty_role := 'developer';
      v_requested_counterparty_actor_id := p_receiver_actor_id;
    elsif exists (
      select 1
        from public.admin_accounts account
       where account.id = p_receiver_actor_id
         and account.active = true
         and coalesce(account.staff_type, 'admin') <> 'developer'
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_receiver_id
    ) then
      v_requested_counterparty_role := 'admin';
      v_requested_counterparty_actor_id := p_receiver_actor_id;
    elsif exists (
      select 1
        from public.manager_accounts account
       where account.id = p_receiver_actor_id
         and account.active = true
         and regexp_replace(account.phone, '[^0-9]', '', 'g') = p_receiver_id
    ) then
      v_requested_counterparty_role := 'manager';
      v_requested_counterparty_actor_id := p_receiver_actor_id;
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
    if v_thread.counterparty_actor_id is null then
      v_counterparty_phone := null;
    else
      select regexp_replace(account.phone, '[^0-9]', '', 'g')
        into v_counterparty_phone
        from public.admin_accounts account
       where account.id = v_thread.counterparty_actor_id
         and account.active = true
         and coalesce(account.staff_type, 'admin') <> 'developer';
      if not found or length(v_counterparty_phone) <> 11 then
        raise exception 'direct_message_recipient_not_found';
      end if;
    end if;
  elsif v_thread.counterparty_role = 'developer' then
    select regexp_replace(account.phone, '[^0-9]', '', 'g')
      into v_counterparty_phone
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
    if v_thread.counterparty_role = 'admin'
       and v_thread.counterparty_actor_id is null then
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
  elsif p_receiver_id = v_fc_phone and p_receiver_actor_id = v_fc_id then
    if v_thread.counterparty_role = 'admin'
       and v_thread.counterparty_actor_id is null then
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
    elsif v_thread.counterparty_role in ('admin', 'developer') then
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

-- Preserve the current RPC implementations (including atomic room-mute
-- accounting) and narrow only the shared-admin branches. Personal admin
-- threads use the existing single-recipient branch.
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
    E'and v_identity.resolved_counterparty_role = \'admin\' then',
    E'and v_identity.resolved_counterparty_role = \'admin\'\n     and v_identity.resolved_counterparty_actor_id is null then'
  );
  if v_definition = v_original then
    raise exception 'personal_admin_direct_text_source_drift';
  end if;
  execute v_definition;

  select pg_get_functiondef(
    'public.commit_garamin_direct_message_with_attachments_v2(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid[])'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'and v_identity.resolved_counterparty_role = \'admin\' then',
    E'and v_identity.resolved_counterparty_role = \'admin\'\n     and v_identity.resolved_counterparty_actor_id is null then'
  );
  if v_definition = v_original then
    raise exception 'personal_admin_direct_attachment_source_drift';
  end if;
  execute v_definition;

  select pg_get_functiondef(
    'public.commit_garamin_direct_broadcast_with_attachments_v2(uuid[],uuid[],uuid,text,uuid,text,uuid[])'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'  v_sender_id := case\n    when v_sender_staff_type = \'developer\' then v_sender_phone\n    else \'admin\'\n  end;',
    E'  v_sender_id := v_sender_phone;'
  );
  if v_definition = v_original then
    raise exception 'personal_admin_direct_broadcast_sender_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'        case\n          when v_sender_staff_type = \'developer\' then p_sender_actor_id\n          else null\n        end',
    E'        p_sender_actor_id'
  );
  if v_definition = v_step then
    raise exception 'personal_admin_direct_broadcast_actor_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'    elsif v_thread.counterparty_role <> \'admin\'\n       or v_thread.counterparty_actor_id is not null then',
    E'    elsif v_thread.counterparty_role <> \'admin\'\n       or v_thread.counterparty_actor_id is distinct from p_sender_actor_id then'
  );
  if v_definition = v_step then
    raise exception 'personal_admin_direct_broadcast_acl_source_drift';
  end if;
  execute v_definition;

  select pg_get_functiondef(
    'public.reserve_messenger_attachment_upload_batch_v2(uuid,text,uuid,text,jsonb,jsonb)'::regprocedure
  ) into v_definition;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    E'        v_requested_counterparty_role := \'admin\';\n        v_requested_counterparty_actor_id := null;',
    E'        v_requested_counterparty_role := \'admin\';\n        v_requested_counterparty_actor_id := p_actor_id;'
  );
  if v_definition = v_original then
    raise exception 'personal_admin_attachment_reservation_actor_source_drift';
  end if;
  v_step := v_definition;
  v_definition := replace(
    v_definition,
    E'      elsif v_thread.counterparty_role <> \'admin\'\n         or v_thread.counterparty_actor_id is not null then',
    E'      elsif v_thread.counterparty_role <> \'admin\'\n         or v_thread.counterparty_actor_id is distinct from p_actor_id then'
  );
  if v_definition = v_step then
    raise exception 'personal_admin_attachment_reservation_acl_source_drift';
  end if;
  execute v_definition;
end;
$migration$;

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

revoke all on function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) to service_role;
