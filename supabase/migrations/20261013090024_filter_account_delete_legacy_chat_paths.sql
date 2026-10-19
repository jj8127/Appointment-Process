-- Keep the account-deletion cleanup receipt limited to legacy direct-message
-- URLs. Private messenger v2 attachment paths are queued by
-- queue_messenger_attachment_actor_cleanup_v2 before the account row is deleted.
create or replace function public.delete_account_core_transaction_v1(
  p_target_role text,
  p_target_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_phone text;
  v_phone_digits text;
  v_fc_ids uuid[] := array[]::uuid[];
  v_fc_id uuid;
  v_proof_paths text[] := array[]::text[];
  v_new_proof_paths text[] := array[]::text[];
  v_document_paths text[] := array[]::text[];
  v_board_paths text[] := array[]::text[];
  v_auth_user_ids uuid[] := array[]::uuid[];
  v_post_ids uuid[] := array[]::uuid[];
  v_cleanup_outbox_id uuid;
  v_deleted_count integer := 0;
begin
  if p_target_id is null or p_target_role not in ('fc', 'admin', 'manager') then
    raise exception using errcode = '22023', message = 'invalid_account_delete_target';
  end if;

  if p_target_role = 'fc' then
    select profile.phone
      into v_phone
      from public.fc_profiles profile
     where profile.id = p_target_id
       and not profile.is_manager_referral_shadow
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;
    v_fc_ids := array[p_target_id];
  elsif p_target_role = 'admin' then
    select account.phone
      into v_phone
      from public.admin_accounts account
     where account.id = p_target_id
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;
  else
    select account.phone
      into v_phone
      from public.manager_accounts account
     where account.id = p_target_id
     for update;
    if v_phone is null then
      raise exception using errcode = 'P0002', message = 'account_delete_target_not_found';
    end if;

    select coalesce(array_agg(profile.id order by profile.id), array[]::uuid[])
      into v_fc_ids
      from public.fc_profiles profile
     where profile.is_manager_referral_shadow
       and regexp_replace(coalesce(profile.phone, ''), '[^0-9]', '', 'g')
           = regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g');
  end if;

  v_phone_digits := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
  if v_phone_digits is null then
    raise exception using errcode = '23514', message = 'account_delete_phone_missing';
  end if;

  if cardinality(v_fc_ids) > 0 then
    perform 1
      from public.fc_profiles profile
     where profile.id = any(v_fc_ids)
     for update;

    if exists (
      select 1
        from public.exam_registrations registration
       where registration.resident_id not like 'deleted-exam:%'
         and (
           (
             registration.fc_id = any(v_fc_ids)
             and nullif(
               regexp_replace(coalesce(registration.resident_id, ''), '[^0-9]', '', 'g'),
               ''
             ) is distinct from v_phone_digits
           )
           or (
             nullif(
               regexp_replace(coalesce(registration.resident_id, ''), '[^0-9]', '', 'g'),
               ''
             ) = v_phone_digits
             and (
               registration.fc_id is null
               or not (registration.fc_id = any(v_fc_ids))
             )
           )
         )
    ) then
      raise exception using
        errcode = '23514',
        message = 'account_delete_exam_ownership_mismatch';
    end if;

    select coalesce(array_agg(document.storage_path), array[]::text[])
      into v_document_paths
      from public.fc_documents document
     where document.fc_id = any(v_fc_ids)
       and document.storage_path is not null
       and document.storage_path <> 'deleted';

    select coalesce(array_agg(profile.id), array[]::uuid[])
      into v_auth_user_ids
      from public.profiles profile
     where profile.fc_id = any(v_fc_ids);

    foreach v_fc_id in array v_fc_ids
    loop
      select coalesce(array_agg(detached.proof_path), array[]::text[])
        into v_new_proof_paths
        from public.detach_exam_registration_identity_for_account_deletion(v_fc_id) detached;
      v_proof_paths := v_proof_paths || v_new_proof_paths;
    end loop;
  end if;

  select coalesce(array_agg(post.id), array[]::uuid[])
    into v_post_ids
    from public.board_posts post
   where regexp_replace(coalesce(post.author_resident_id, ''), '[^0-9]', '', 'g')
         = v_phone_digits;

  select coalesce(array_agg(distinct attachment.storage_path), array[]::text[])
    into v_board_paths
    from public.board_attachments attachment
   where regexp_replace(coalesce(attachment.created_by_resident_id, ''), '[^0-9]', '', 'g')
         = v_phone_digits
      or attachment.post_id = any(v_post_ids);

  -- Legacy chat uploads used shared `chat/` and `group-chat/` prefixes without
  -- an owner identifier. A message row therefore cannot prove ownership of the
  -- referenced object. Keep these objects out of the service-role cleanup
  -- receipt instead of trusting a user-controlled legacy file_url.

  delete from public.board_comment_likes
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_post_reactions
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_post_views
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_comments
   where regexp_replace(coalesce(author_resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_attachments
   where regexp_replace(coalesce(created_by_resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.board_posts where id = any(v_post_ids);

  if to_regclass('public.messages') is not null then
    execute $dynamic$
      delete from public.messages
       where regexp_replace(coalesce(sender_id, ''), '[^0-9]', '', 'g') = $1
          or regexp_replace(coalesce(receiver_id, ''), '[^0-9]', '', 'g') = $1
    $dynamic$
    using v_phone_digits;
  end if;

  delete from public.notifications
   where (cardinality(v_fc_ids) > 0 and fc_id = any(v_fc_ids))
      or regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.device_tokens
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.web_push_subscriptions
   where regexp_replace(coalesce(resident_id, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.user_presence
   where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.notices
   where regexp_replace(coalesce(created_by, ''), '[^0-9]', '', 'g') = v_phone_digits;

  delete from public.referral_events
   where regexp_replace(coalesce(inviter_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      or regexp_replace(coalesce(invitee_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  delete from public.referral_attributions
   where regexp_replace(coalesce(inviter_phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      or regexp_replace(coalesce(invitee_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;

  if p_target_role = 'manager' then
    delete from public.affiliation_manager_mappings
     where regexp_replace(coalesce(manager_phone, ''), '[^0-9]', '', 'g') = v_phone_digits;
  end if;

  if cardinality(v_fc_ids) > 0 then
    delete from public.profiles where fc_id = any(v_fc_ids);
    delete from public.fc_profiles where id = any(v_fc_ids);
  end if;

  if p_target_role = 'admin' then
    delete from public.admin_accounts where id = p_target_id;
  elsif p_target_role = 'manager' then
    delete from public.manager_accounts where id = p_target_id;
  end if;
  get diagnostics v_deleted_count = row_count;

  if p_target_role = 'fc' then
    v_deleted_count := case
      when exists (select 1 from public.fc_profiles where id = p_target_id) then 0
      else 1
    end;
  end if;

  if v_deleted_count <> 1 then
    raise exception using errcode = 'P0002', message = 'account_delete_target_not_deleted';
  end if;

  insert into public.account_deletion_cleanup_outbox (
    cleanup_payload
  ) values (
    jsonb_build_object(
      'proof_paths', to_jsonb(v_proof_paths),
      'document_paths', to_jsonb(v_document_paths),
      'board_attachment_paths', to_jsonb(v_board_paths),
      'chat_file_urls', '[]'::jsonb,
      'auth_user_ids', to_jsonb(v_auth_user_ids)
    )
  )
  returning id into v_cleanup_outbox_id;

  return jsonb_build_object(
    'deleted', true,
    'cleanup_outbox_id', v_cleanup_outbox_id,
    'proof_paths', to_jsonb(v_proof_paths),
    'document_paths', to_jsonb(v_document_paths),
    'board_attachment_paths', to_jsonb(v_board_paths),
    'chat_file_urls', '[]'::jsonb,
    'auth_user_ids', to_jsonb(v_auth_user_ids)
  );
end;
$$;

revoke all on function public.delete_account_core_transaction_v1(
  text, uuid
) from public, anon, authenticated;
grant execute on function public.delete_account_core_transaction_v1(
  text, uuid
) to service_role;
