-- Ordinary common/FC withdrawal. Company admin/manager accounts are exempt.
-- Two databases cannot share a transaction: revoke admission first, require an
-- exact affiliate receipt, then erase locally and confirm external cleanup.
set local lock_timeout='3s';
set local statement_timeout='30s';
alter table public.fc_profiles add column account_closed_at timestamptz;

create table public.platform_account_withdrawals (
  operation_id uuid primary key,
  member_id uuid not null unique references public.platform_members(id) on delete restrict,
  session_digest text not null check(session_digest ~ '^[0-9a-f]{64}$'),
  source_fc_id uuid references public.fc_profiles(id) on delete restrict,
  preserved_company_role text check(preserved_company_role in ('admin','manager','designer','developer')),
  local_erased boolean not null default false,
  completed boolean not null default false,
  cleanup_receipt jsonb,
  cleanup_outbox_id uuid references public.account_deletion_cleanup_outbox(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0 check(attempt_count>=0),
  pending_reason text check(pending_reason in ('affiliate_identity_unbound','affiliate_unavailable','cleanup_pending'))
);
alter table public.platform_account_withdrawals enable row level security;
revoke all on public.platform_account_withdrawals from public,anon,authenticated;
grant select,insert,update on public.platform_account_withdrawals to service_role;
create index platform_withdrawals_due on public.platform_account_withdrawals(next_attempt_at,created_at)
  where not completed;

create table public.platform_withdrawal_messenger_cleanup (
  operation_id uuid references public.platform_account_withdrawals(operation_id) on delete restrict,
  cleanup_id uuid references public.messenger_attachment_cleanup_outbox(id) on delete restrict,
  primary key(operation_id,cleanup_id)
);
alter table public.platform_withdrawal_messenger_cleanup enable row level security;
revoke all on public.platform_withdrawal_messenger_cleanup from public,anon,authenticated;
grant select,insert on public.platform_withdrawal_messenger_cleanup to service_role;

create function public.erase_completed_account_cleanup_payload_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if new.status='completed' then
    new.cleanup_payload:='{}'::jsonb;
    update platform_account_withdrawals set cleanup_receipt=null where cleanup_outbox_id=new.id;
  end if;
  return new;
end $$;
revoke all on function public.erase_completed_account_cleanup_payload_v1() from public,anon,authenticated;
create trigger account_completed_cleanup_payload before update of status on public.account_deletion_cleanup_outbox
  for each row execute function public.erase_completed_account_cleanup_payload_v1();

create function public.guard_closed_fc_account_v1() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
declare target uuid;
begin
  if tg_table_name='fc_profiles' then target:=old.id; else target:=new.fc_id; end if;
  if exists(select from fc_profiles where id=target and account_closed_at is not null)
    and current_setting('moduon.fc_closure_id',true) is distinct from target::text then
    raise exception 'account_closed';
  end if;
  return new;
end $$;
revoke all on function public.guard_closed_fc_account_v1() from public,anon,authenticated;
create trigger fc_closed_account_write_guard before update on public.fc_profiles
  for each row execute function public.guard_closed_fc_account_v1();
create trigger fc_closed_credentials_guard before insert or update on public.fc_credentials
  for each row execute function public.guard_closed_fc_account_v1();
create trigger fc_closed_completion_guard before insert or update on public.fc_signup_completion_challenges
  for each row execute function public.guard_closed_fc_account_v1();

create or replace function public.queue_messenger_attachment_actor_cleanup_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_actor_role text;
  v_operation_id uuid:=nullif(current_setting('moduon.withdrawal_operation_id',true),'')::uuid;
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_lock record;
  v_lock_conversation_id uuid;
  v_target_conversation_ids uuid[];
  v_broadcast_batch record;
  v_reconciled_conversation_ids uuid[];
  v_remaining integer;
begin
  v_actor_role := case tg_table_name
    when 'fc_profiles' then 'fc'
    when 'manager_accounts' then 'manager'
    when 'admin_accounts' then 'admin'
    else null
  end;
  if v_actor_role is null then
    raise exception 'invalid_attachment_actor_cleanup_trigger';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(v_actor_role || ':' || old.id::text, 0)
  );

  if v_actor_role = 'fc' then
    select array_agg(conversation.id order by conversation.id)
      into v_target_conversation_ids
      from public.garamin_direct_conversations conversation
     where conversation.fc_id = old.id;

    -- Lock every affected batch owner before taking batch row locks. This keeps
    -- reserve/commit/delete serialization in the same actor-lock order.
    for v_lock in
      select distinct affected.actor_role, affected.actor_id
        from (
          select batch.actor_role, batch.actor_id
            from public.messenger_attachment_delivery_batches batch
           where batch.context_kind = 'direct'
             and batch.conversation_id = any(v_target_conversation_ids)
             and batch.status not in ('deleted', 'revoked')
          union
          select batch.actor_role, batch.actor_id
            from public.messenger_attachment_delivery_batches batch
           where batch.context_kind = 'direct_broadcast'
             and batch.conversation_ids && v_target_conversation_ids
             and batch.status not in ('deleted', 'revoked')
        ) affected
       order by affected.actor_role, affected.actor_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(v_lock.actor_role || ':' || v_lock.actor_id::text, 0)
      );
    end loop;

    -- Reserve and commit take the same context locks after their actor lock.
    -- Once these are held no new pending/committed delivery can enter a
    -- conversation that is being cascaded away.
    for v_lock_conversation_id in
      select conversation_id
        from unnest(v_target_conversation_ids) requested(conversation_id)
       order by conversation_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(
          'messenger-direct-context:' || v_lock_conversation_id::text,
          0
        )
      );
    end loop;

    -- The legacy account-delete transaction may hard-delete recipient message
    -- rows before this profile trigger runs. Reconcile broadcast batches from
    -- their durable conversation context, then derive the surviving reference
    -- count from whichever undeleted messages remain.
    for v_broadcast_batch in
      select batch.id, batch.status
        from public.messenger_attachment_delivery_batches batch
       where batch.context_kind = 'direct_broadcast'
         and batch.conversation_ids && v_target_conversation_ids
         and batch.status not in ('deleted', 'revoked')
       order by batch.id
       for update
    loop
      update public.messages
         set deleted_at = coalesce(deleted_at, v_now),
             deleted_by_actor_id = coalesce(deleted_by_actor_id, old.id),
             content = ''
       where attachment_batch_id = v_broadcast_batch.id
         and conversation_id = any(v_target_conversation_ids)
         and deleted_at is null;

      if v_broadcast_batch.status = 'committed' then
        select array_agg(
                 distinct message.conversation_id
                 order by message.conversation_id
               ),
               count(*)
          into v_reconciled_conversation_ids, v_remaining
          from public.messages message
         where message.attachment_batch_id = v_broadcast_batch.id
           and message.conversation_id is not null
           and message.deleted_at is null;
        if v_remaining > 0 then
          update public.messenger_attachment_delivery_batches
             set conversation_ids = v_reconciled_conversation_ids,
                 updated_at = v_now
           where id = v_broadcast_batch.id;
          update public.messenger_attachment_objects
             set reference_count = v_remaining
           where batch_id = v_broadcast_batch.id
             and status = 'active';
        end if;
      end if;
    end loop;
  end if;

  for v_batch in
    select batch.*
      from public.messenger_attachment_delivery_batches batch
     where (
         (
           batch.actor_id = old.id
           and batch.actor_role = v_actor_role
         )
         or (
           v_actor_role = 'fc'
           and batch.context_kind = 'direct'
           and batch.conversation_id = any(v_target_conversation_ids)
         )
         or (
           v_actor_role = 'fc'
           and batch.context_kind = 'direct_broadcast'
           and batch.conversation_ids && v_target_conversation_ids
           and (
             batch.status in ('pending', 'expired')
             or (
               batch.status = 'committed'
               and not exists (
                 select 1
                   from public.messages message
                  where message.attachment_batch_id = batch.id
                    and message.deleted_at is null
               )
             )
           )
         )
       )
       and batch.status not in ('deleted', 'revoked')
     for update
  loop
    update public.messages
       set deleted_at = coalesce(deleted_at, v_now),
           deleted_by_actor_id = coalesce(deleted_by_actor_id, old.id),
           content = ''
     where attachment_batch_id = v_batch.id
       and deleted_at is null;
    update public.group_chat_messages
       set deleted_at = coalesce(deleted_at, v_now),
           content = ''
     where attachment_batch_id = v_batch.id
       and deleted_at is null;
    delete from public.group_chat_notices notice
     where notice.message_id in (
       select message.id
         from public.group_chat_messages message
        where message.attachment_batch_id = v_batch.id
     );

    insert into public.messenger_attachment_deletion_audit (
      original_name,
      byte_size,
      sha256,
      reason_code,
      deleted_at
    )
    select case when v_operation_id is not null then '삭제' else attachment.original_name end,
           attachment.byte_size,
           attachment.sha256,
           'account_deleted',
           v_now
      from public.messenger_attachment_objects attachment
     where attachment.batch_id = v_batch.id
       and attachment.status = 'active';

    insert into public.messenger_attachment_cleanup_outbox (
      attachment_id,
      batch_id,
      bucket_id,
      storage_path,
      reason_code,
      sweep_phase,
      not_before
    )
    select candidate.attachment_id,
           v_batch.id,
           candidate.bucket_id,
           candidate.storage_path,
           'account_deleted',
           phase.sweep_phase,
           case phase.sweep_phase
             when 'immediate' then v_now
             else greatest(v_batch.expires_at, v_now) + interval '5 minutes'
           end
      from (
        select attachment.id as attachment_id,
               attachment.bucket_id,
               attachment.storage_path
          from public.messenger_attachment_objects attachment
         where attachment.batch_id = v_batch.id
           and attachment.storage_path is not null
        union all
        select null::uuid,
               intent.bucket_id,
               intent.object_path
          from public.messenger_attachment_upload_intents intent
         where intent.batch_id = v_batch.id
           and intent.object_path is not null
      ) candidate
      cross join (
        values ('immediate'::text), ('post_token_expiry'::text)
      ) phase(sweep_phase)
    on conflict (bucket_id, storage_path, sweep_phase)
      where bucket_id is not null and storage_path is not null
    do update set
      not_before = least(
        public.messenger_attachment_cleanup_outbox.not_before,
        excluded.not_before
      ),
      status = case
        when public.messenger_attachment_cleanup_outbox.status = 'completed'
          then 'pending'
        else public.messenger_attachment_cleanup_outbox.status
      end,
      completed_at = null,
      updated_at = v_now;

    update public.messenger_attachment_upload_intents
       set status = 'revoked',
           object_path = null,
           updated_at = v_now
     where batch_id = v_batch.id
       and status in ('pending', 'validated', 'expired');
    update public.messenger_attachment_objects
       set bucket_id = null,
           storage_path = null,
           reference_count = 0,
           status = 'tombstoned',
           tombstoned_at = coalesce(tombstoned_at, v_now)
     where batch_id = v_batch.id
       and status = 'active';
    update public.messenger_attachment_delivery_batches
       set status = 'deleted',
           deleted_at = coalesce(deleted_at, v_now),
           updated_at = v_now
     where id = v_batch.id;
    if v_operation_id is not null then
      if not exists(select from platform_account_withdrawals where operation_id=v_operation_id
        and source_fc_id=old.id) then raise exception 'forbidden'; end if;
      insert into platform_withdrawal_messenger_cleanup(operation_id,cleanup_id)
        select v_operation_id,id from messenger_attachment_cleanup_outbox where batch_id=v_batch.id
        on conflict do nothing;
      update messenger_attachment_deletion_audit audit set original_name='삭제'
        where exists(select from messenger_attachment_objects o where o.batch_id=v_batch.id
          and o.sha256=audit.sha256 and o.original_name=audit.original_name);
      update messenger_attachment_upload_intents set original_name='삭제',object_path=null,status='revoked'
        where batch_id=v_batch.id;
      update messenger_attachment_objects set original_name='삭제' where batch_id=v_batch.id;
    end if;
  end loop;
  if tg_op='UPDATE' then return new; end if;
  return old;
end;
$$;
create trigger trg_queue_fc_withdrawal_messenger_cleanup before update of account_closed_at on public.fc_profiles
  for each row when(old.account_closed_at is null and new.account_closed_at is not null)
  execute function public.queue_messenger_attachment_actor_cleanup_v2();

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
    if p_target_role = 'fc'
      and current_setting('moduon.fc_closure_id',true) = p_target_id::text then
      -- Financial snapshots still reference this UUID. Erase account data,
      -- never cascade settled business history or fabricate another identity.
      -- This upload namespace proves ownership; legacy arbitrary URLs do not.
      select v_document_paths || coalesce(array_agg(hanwha_commission_pdf_path),array[]::text[])
        into v_document_paths from public.fc_profiles
        where id=p_target_id and hanwha_commission_pdf_path like 'hanwha-url-pdf/'||id::text||'/%'
          and position('/../' in hanwha_commission_pdf_path)=0;
      delete from public.fc_documents where fc_id=p_target_id;
      delete from public.fc_identity_secure where fc_id=p_target_id;
      delete from public.fc_credentials where fc_id=p_target_id;
      delete from public.fc_signup_completion_challenges where fc_id=p_target_id;
      delete from public.admin_assisted_signup_consents where fc_id=p_target_id;
      delete from public.referral_codes where fc_id=p_target_id;
      update public.fc_profiles set
        phone='deleted-fc:'||id::text,name='탈퇴 회원',affiliation='삭제',
        temp_id=null,resident_id_masked=null,resident_id_hash=null,
        email=null,address=null,address_detail=null,carrier=null,career_type=null,license_statuses=null,
        recommender=null,recommender_code=null,recommender_code_id=null,
        admin_memo=null,appointment_url=null,hanwha_commission_pdf_path=null,hanwha_commission_pdf_name=null,
        allowance_reject_reason=null,hanwha_commission_reject_reason=null,
        appointment_reject_reason_life=null,appointment_reject_reason_nonlife=null,
        dawichok_url_sent_by=null,phone_verified=false,phone_verified_at=null,
        phone_verification_hash=null,phone_verification_expires_at=null,
        phone_verification_sent_at=null,phone_verification_attempts=0,phone_verification_locked_until=null,
        signup_completed=false,identity_completed=false,signup_verification_method=null,
        signup_verified_at=null,signup_verified_by_admin_id=null,updated_at=clock_timestamp()
        where id=p_target_id;
      update public.fc_profiles set recommender=null,recommender_code=null,recommender_code_id=null
        where recommender_fc_id=p_target_id and account_closed_at is null;
    else
      delete from public.fc_profiles where id = any(v_fc_ids);
    end if;
  end if;

  if p_target_role = 'admin' then
    delete from public.admin_accounts where id = p_target_id;
  elsif p_target_role = 'manager' then
    delete from public.manager_accounts where id = p_target_id;
  end if;
  get diagnostics v_deleted_count = row_count;

  if p_target_role = 'fc' then
    v_deleted_count := case
      when current_setting('moduon.fc_closure_id',true)=p_target_id::text
        and exists(select from public.fc_profiles where id=p_target_id
          and phone='deleted-fc:'||id::text and not signup_completed and account_closed_at is not null)
        and not exists(select from public.fc_credentials where fc_id=p_target_id) then 1
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

-- The old function remains available only to trusted deletion paths; its
-- staff authorization and normal hard-delete semantics are unchanged.

create function public.get_platform_withdrawal_v1(p_operation_id uuid,p_session_digest text)
returns jsonb language sql security invoker set search_path=public,pg_temp as $$
  select to_jsonb(w) from platform_account_withdrawals w
    where (p_operation_id is null or operation_id=p_operation_id) and session_digest=p_session_digest
    order by created_at desc,operation_id limit 1;
$$;

create function public.begin_platform_withdrawal_v1(
  p_member_id uuid,p_operation_id uuid,p_session_digest text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare m platform_members; f fc_profiles; w platform_account_withdrawals; source_phone text; source_fc uuid;
  source_staff_id uuid; source_staff_kind text;
begin
  if p_operation_id is null or p_member_id is null or p_session_digest is null
    or p_session_digest !~ '^[0-9a-f]{64}$' then raise exception 'invalid_input'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,741014));
  select * into w from platform_account_withdrawals where operation_id=p_operation_id;
  if found then
    if w.member_id<>p_member_id or w.session_digest<>p_session_digest then raise exception 'forbidden'; end if;
    return to_jsonb(w);
  end if;
  select * into m from platform_members where id=p_member_id;
  if not found or not m.active or m.phone is null then raise exception 'member_unavailable'; end if;
  source_phone:=m.phone;
  source_fc:=m.fc_id; source_staff_id:=m.staff_account_id; source_staff_kind:=m.staff_account_kind;
  -- Same phone-advisory domain as signup/enrollment, then source profile,
  -- common member, credentials. Never reverse the existing profile/member order.
  perform pg_advisory_xact_lock(hashtextextended(source_phone,741012));
  if m.fc_id is not null then
    select * into f from fc_profiles where id=m.fc_id for update;
    if not found or f.phone<>source_phone or f.signup_completed is distinct from true
      or f.is_manager_referral_shadow or f.account_closed_at is not null
      then raise exception 'forbidden'; end if;
  end if;
  select * into m from platform_members where id=p_member_id for update;
  if not m.active or m.phone is distinct from source_phone
    or m.fc_id is distinct from source_fc or m.staff_account_id is distinct from source_staff_id
    or m.staff_account_kind is distinct from source_staff_kind then raise exception 'forbidden'; end if;
  insert into platform_account_withdrawals(operation_id,member_id,session_digest,source_fc_id,preserved_company_role)
    values(p_operation_id,m.id,p_session_digest,m.fc_id,m.staff_account_kind) returning * into w;
  if f.id is not null then
    perform set_config('moduon.withdrawal_operation_id',w.operation_id::text,true);
    update fc_profiles set account_closed_at=clock_timestamp(),signup_completed=false where id=f.id;
    perform set_config('moduon.withdrawal_operation_id','',true);
    delete from fc_credentials where fc_id=f.id;
    delete from fc_signup_completion_challenges where fc_id=f.id;
  end if;
  delete from platform_member_credentials where member_id=m.id;
  delete from platform_signup_challenges where phone=m.phone or consumed_member_id=m.id;
  update platform_members set active=false where id=m.id;
  return to_jsonb(w);
end $$;

create function public.erase_platform_withdrawal_v1(
  p_operation_id uuid,p_session_digest text,p_affiliate_state text,p_preserved_company_role text default null)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare w platform_account_withdrawals; receipt jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,741014));
  select * into w from platform_account_withdrawals
    where operation_id=p_operation_id and session_digest=p_session_digest;
  if not found then raise exception 'forbidden'; end if;
  if w.local_erased then return to_jsonb(w); end if;
  if w.source_fc_id is not null then
    if p_affiliate_state not in ('erased','company_account_preserved') or p_affiliate_state is null
      or (p_affiliate_state='company_account_preserved' and
        coalesce(p_preserved_company_role,'') not in ('admin','manager','designer','developer')) then raise exception 'affiliate_receipt_required'; end if;
    perform from fc_profiles where id=w.source_fc_id for update;
  elsif p_affiliate_state is distinct from 'not_applicable' then raise exception 'forbidden'; end if;
  perform from platform_members where id=w.member_id for update;
  if w.source_fc_id is not null then
    perform set_config('moduon.fc_closure_id',w.source_fc_id::text,true);
    receipt:=delete_account_core_transaction_v1('fc',w.source_fc_id);
    perform set_config('moduon.fc_closure_id','',true);
  end if;
  -- Reuse the existing erase-only function. It does not call the core delete
  -- transaction, so BEFORE DELETE projection triggers cannot recurse.
  perform delete_platform_member(w.member_id);
  update platform_account_withdrawals set local_erased=true,cleanup_receipt=receipt,
    cleanup_outbox_id=(receipt->>'cleanup_outbox_id')::uuid,
    preserved_company_role=coalesce(p_preserved_company_role,preserved_company_role)
    where operation_id=w.operation_id returning * into w;
  return to_jsonb(w);
end $$;

create function public.complete_platform_withdrawal_v1(p_operation_id uuid,p_session_digest text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare w platform_account_withdrawals;
begin
  select * into w from platform_account_withdrawals
    where operation_id=p_operation_id and session_digest=p_session_digest for update;
  if not found or not w.local_erased then raise exception 'forbidden'; end if;
  if w.cleanup_outbox_id is not null and not exists(select from account_deletion_cleanup_outbox
    where id=w.cleanup_outbox_id and status='completed') then raise exception 'cleanup_pending'; end if;
  if exists(select from platform_withdrawal_messenger_cleanup link
    join messenger_attachment_cleanup_outbox q on q.id=link.cleanup_id
    where link.operation_id=w.operation_id and q.status<>'completed') then raise exception 'cleanup_pending'; end if;
  update platform_account_withdrawals set completed=true,cleanup_receipt=null,pending_reason=null,completed_at=coalesce(completed_at,clock_timestamp())
    where operation_id=w.operation_id returning * into w;
  return to_jsonb(w);
end $$;

revoke all on function public.get_platform_withdrawal_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.begin_platform_withdrawal_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.erase_platform_withdrawal_v1(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.complete_platform_withdrawal_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.get_platform_withdrawal_v1(uuid,text) to service_role;
grant execute on function public.begin_platform_withdrawal_v1(uuid,uuid,text) to service_role;
grant execute on function public.erase_platform_withdrawal_v1(uuid,text,text,text) to service_role;
grant execute on function public.complete_platform_withdrawal_v1(uuid,text) to service_role;

create function public.get_platform_withdrawal_cleanup_v1(p_operation_id uuid,p_session_digest text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if not exists(select from platform_account_withdrawals where operation_id=p_operation_id
    and session_digest=p_session_digest) then raise exception 'forbidden'; end if;
  return jsonb_build_object('batch_ids',coalesce((select jsonb_agg(batch_id) from(
    select distinct q.batch_id from platform_withdrawal_messenger_cleanup link
      join messenger_attachment_cleanup_outbox q on q.id=link.cleanup_id
      where link.operation_id=p_operation_id and q.status<>'completed' and q.batch_id is not null
      order by q.batch_id limit 25) batches),'[]'::jsonb),
    'pending',exists(select from platform_withdrawal_messenger_cleanup link
      join messenger_attachment_cleanup_outbox q on q.id=link.cleanup_id
      where link.operation_id=p_operation_id and q.status<>'completed'));
end $$;
revoke all on function public.get_platform_withdrawal_cleanup_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.get_platform_withdrawal_cleanup_v1(uuid,text) to service_role;

create function public.record_platform_withdrawal_retry_v1(p_operation_id uuid,p_session_digest text,p_reason text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if coalesce(p_reason,'') not in ('affiliate_identity_unbound','affiliate_unavailable','cleanup_pending')
    then raise exception 'invalid_input'; end if;
  update platform_account_withdrawals set pending_reason=p_reason,attempt_count=least(attempt_count+1,1000000),
    next_attempt_at=clock_timestamp()+make_interval(secs=>case when p_reason='affiliate_identity_unbound' then 300
      else least(3600,(30*power(2,least(attempt_count,7)))::integer) end)
    where operation_id=p_operation_id and session_digest=p_session_digest and not completed;
  if not found then
    if exists(select from platform_account_withdrawals where operation_id=p_operation_id
      and session_digest=p_session_digest and completed) then
      return jsonb_build_object('recorded',false,'completed',true);
    end if;
    raise exception 'forbidden';
  end if;
  return jsonb_build_object('recorded',true,'completed',false);
end $$;
create function public.list_due_platform_withdrawals_v1() returns jsonb
language sql security invoker set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(w)),'[]'::jsonb) from(
    select * from platform_account_withdrawals where not completed and next_attempt_at<=clock_timestamp()
      order by next_attempt_at,created_at,operation_id limit 3) w;
$$;
revoke all on function public.record_platform_withdrawal_retry_v1(uuid,text,text) from public,anon,authenticated;
revoke all on function public.list_due_platform_withdrawals_v1() from public,anon,authenticated;
grant execute on function public.record_platform_withdrawal_retry_v1(uuid,text,text) to service_role;
grant execute on function public.list_due_platform_withdrawals_v1() to service_role;
