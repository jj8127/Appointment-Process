-- Messenger stage 1, finishing work (decisions 2026-10-16):
-- 1. Headquarters (본부) become sub-organizations of 가람, assigned
--    automatically from the affiliation number ("1본부 서선미" -> 1본부).
-- 2. A room whose late backfill landed out of time order is renumbered.
--    Safe only while no client reads the unified model (stage 1).
-- 3. Thread-less legacy messages whose participant no longer exists are kept
--    for a grace period after detection, then purged by the operator.
-- 4. GaramLink attachments are imported as file/image messages that point at
--    copies in the private 'messenger-imported-attachments' bucket.
-- 5. GaramLink deletions arrive through their own cursor feed.

-- ---------------------------------------------------------------------------
-- 1. Headquarters sub-organizations
-- ---------------------------------------------------------------------------
create or replace function public.messenger_headquarters_numbers(p_affiliation text)
returns integer[]
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct m[1]::integer order by m[1]::integer), '{}')
    from regexp_matches(coalesce(p_affiliation, ''), '(?:^|[^0-9])(10|[1-9])\s*(?:본부|팀)(?=$|[^가-힣0-9])', 'g') as m;
$$;

create or replace function public.messenger_sync_headquarters_v1()
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_garam uuid := public.messenger_org_by_slug('garam');
  v_approved integer;
  v_revoked integer;
  v_unknown integer;
begin
  if v_garam is null then
    return jsonb_build_object('skipped', 'garam_missing');
  end if;

  -- One row per (person, headquarters). A manager is the person behind an
  -- active manager account with the same phone as an FC profile.
  create temp table if not exists messenger_hq_desired (
    actor_id uuid not null, hq integer not null, role text not null
  ) on commit drop;
  truncate messenger_hq_desired;
  insert into messenger_hq_desired (actor_id, hq, role)
  select distinct coalesce(public.messenger_actor_for('manager', ma.id::text), public.messenger_actor_for('fc', f.id::text)),
         n, case when ma.id is not null then 'manager' else 'fc' end
    from public.fc_profiles f
    left join public.manager_accounts ma on ma.phone = f.phone and ma.active
    cross join lateral unnest(public.messenger_headquarters_numbers(f.affiliation)) as n
   where coalesce(f.signup_completed, false)
     and not coalesce(f.is_manager_referral_shadow, false)
     and f.account_closed_at is null
     and coalesce(public.messenger_actor_for('manager', ma.id::text), public.messenger_actor_for('fc', f.id::text)) is not null;

  insert into public.messenger_orgs (kind, parent_id, slug, name)
  select distinct 'garam', v_garam, 'garam-hq-' || hq, hq || '본부' from messenger_hq_desired
  on conflict (slug) do nothing;

  with up as (
    insert into public.messenger_org_members (org_id, actor_id, role, status, approved_at)
    select o.id, d.actor_id, d.role, 'approved', now()
      from messenger_hq_desired d join public.messenger_orgs o on o.slug = 'garam-hq-' || d.hq
    on conflict (org_id, actor_id, role) do update
       set status = 'approved', approved_at = now(), revoked_at = null, updated_at = now()
     where public.messenger_org_members.status <> 'approved'
    returning 1
  )
  select count(*) into v_approved from up;

  with gone as (
    update public.messenger_org_members m
       set status = 'revoked', revoked_at = now(), updated_at = now()
      from public.messenger_orgs o
     where o.id = m.org_id and o.parent_id = v_garam and o.slug like 'garam-hq-%'
       and m.status = 'approved'
       and not exists (select 1 from messenger_hq_desired d
                        where d.actor_id = m.actor_id and d.role = m.role and o.slug = 'garam-hq-' || d.hq)
    returning 1
  )
  select count(*) into v_revoked from gone;

  -- Active managers whose headquarters cannot be read stay in 가람 only.
  with unknown as (
    select ma.id from public.manager_accounts ma
     where ma.active
       and not exists (select 1 from public.fc_profiles f
                        where f.phone = ma.phone and cardinality(public.messenger_headquarters_numbers(f.affiliation)) > 0)
  )
  select count(*) into v_unknown from unknown;
  perform public.messenger_record_issue_once('manager_accounts', ma.id::text, 'headquarters_unknown')
     from public.manager_accounts ma
    where ma.active
      and not exists (select 1 from public.fc_profiles f
                       where f.phone = ma.phone and cardinality(public.messenger_headquarters_numbers(f.affiliation)) > 0);

  return jsonb_build_object('approved', v_approved, 'revoked', v_revoked, 'managersWithoutHeadquarters', v_unknown);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Room order repair
-- ---------------------------------------------------------------------------
-- Messages keep the set of sequence slots they occupy; the slots are handed out
-- again in (created_at, id) order. Replies, events, reactions and the pinned
-- notice follow their message. Read positions stay as they are.
create or replace function public.messenger_repair_conversation_order_v1(p_conversation_id uuid)
returns integer
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_old bigint[];
  v_new bigint[];
  v_offset bigint;
  v_reactions jsonb;
begin
  select last_event_seq + 1 into v_offset
    from public.messenger_conversations where id = p_conversation_id for update;
  if not found then
    return 0;
  end if;

  select coalesce(array_agg(o.seq order by o.seq), '{}'), coalesce(array_agg(n.seq order by o.seq), '{}')
    into v_old, v_new
    from (select seq, row_number() over (order by created_at, id) rn
            from public.messenger_messages where conversation_id = p_conversation_id) o
    join (select seq, row_number() over (order by seq) rn
            from public.messenger_messages where conversation_id = p_conversation_id) n on n.rn = o.rn
   where o.seq <> n.seq;

  if cardinality(v_old) > 0 then
    select jsonb_agg(to_jsonb(r)) into v_reactions
      from public.messenger_reactions r
     where r.conversation_id = p_conversation_id and r.message_seq = any(v_old);
    delete from public.messenger_reactions
     where conversation_id = p_conversation_id and message_seq = any(v_old);

    -- Two steps through free slots above last_event_seq keep keys unique.
    update public.messenger_messages set seq = seq + v_offset
     where conversation_id = p_conversation_id and seq = any(v_old);
    update public.messenger_messages m set seq = map.new_seq
      from unnest(v_old, v_new) as map(old_seq, new_seq)
     where m.conversation_id = p_conversation_id and m.seq = map.old_seq + v_offset;
    update public.messenger_messages m set reply_to_seq = map.new_seq
      from unnest(v_old, v_new) as map(old_seq, new_seq)
     where m.conversation_id = p_conversation_id and m.reply_to_seq = map.old_seq;

    update public.messenger_events set event_seq = event_seq + v_offset
     where conversation_id = p_conversation_id and type = 'message' and event_seq = any(v_old);
    update public.messenger_events e set event_seq = map.new_seq
      from unnest(v_old, v_new) as map(old_seq, new_seq)
     where e.conversation_id = p_conversation_id and e.type = 'message' and e.event_seq = map.old_seq + v_offset;
    update public.messenger_events e set message_seq = map.new_seq
      from unnest(v_old, v_new) as map(old_seq, new_seq)
     where e.conversation_id = p_conversation_id and e.message_seq = map.old_seq;

    insert into public.messenger_reactions (conversation_id, message_seq, actor_id, reaction, created_at, updated_at)
    select r.conversation_id, map.new_seq, r.actor_id, r.reaction, r.created_at, r.updated_at
      from jsonb_populate_recordset(null::public.messenger_reactions, coalesce(v_reactions, '[]'::jsonb)) r
      join unnest(v_old, v_new) as map(old_seq, new_seq) on map.old_seq = r.message_seq;

    update public.messenger_conversations c set pinned_notice_seq = map.new_seq, updated_at = now()
      from unnest(v_old, v_new) as map(old_seq, new_seq)
     where c.id = p_conversation_id and c.pinned_notice_seq = map.old_seq;
  end if;

  update public.messenger_sync_issues set resolved_at = now()
   where source = 'messenger_conversation' and source_key = p_conversation_id::text
     and reason = 'late_backfill_out_of_order' and resolved_at is null;
  return cardinality(v_old);
end;
$$;

create or replace function public.messenger_repair_late_conversations_v1()
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  c record;
  v_rooms integer := 0;
  v_moved integer := 0;
begin
  for c in
    select distinct source_key::uuid as id from public.messenger_sync_issues
     where source = 'messenger_conversation' and reason = 'late_backfill_out_of_order' and resolved_at is null
  loop
    v_moved := v_moved + public.messenger_repair_conversation_order_v1(c.id);
    v_rooms := v_rooms + 1;
  end loop;
  return jsonb_build_object('rooms', v_rooms, 'messagesMoved', v_moved);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Retention of messages whose participant no longer exists
-- ---------------------------------------------------------------------------
-- The privacy policy keeps member data only while the membership lasts. The
-- grace period gives a re-registered phone time to be matched again by the
-- daily backfill. Listing never returns message text or phone numbers.
create or replace function public.messenger_orphan_purge_candidates_v1(p_grace interval default interval '30 days')
returns table (message_id uuid, created_at timestamptz, detected_at timestamptz, has_file boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  select m.id, m.created_at, i.created_at, m.file_url is not null
    from public.messenger_sync_issues i
    join public.messages m on m.id::text = i.source_key
   where i.source = 'messages' and i.reason = 'orphan_participant_missing' and i.resolved_at is null
     and i.created_at < now() - p_grace
     and not exists (select 1 from public.messenger_orphan_placements p where p.message_id = m.id)
   order by m.created_at, m.id;
$$;

-- Deletes the candidates for good. The operator passes the count the listing
-- showed; any other count refuses the whole purge. Returns the storage paths
-- of attached files so they can be removed from the bucket as well.
create or replace function public.messenger_purge_orphan_messages_v1(
  p_expected_count integer,
  p_grace interval default interval '30 days'
)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_ids uuid[];
  v_files text[];
begin
  select coalesce(array_agg(message_id), '{}') into v_ids
    from public.messenger_orphan_purge_candidates_v1(p_grace);
  if cardinality(v_ids) <> p_expected_count then
    raise exception 'purge_count_mismatch: expected %, found %', p_expected_count, cardinality(v_ids);
  end if;
  select coalesce(array_agg(file_url) filter (where file_url is not null), '{}') into v_files
    from public.messages where id = any(v_ids);
  delete from public.messages where id = any(v_ids);
  update public.messenger_sync_issues set resolved_at = now(), detail = detail || '{"purged":true}'::jsonb
   where source = 'messages' and reason = 'orphan_participant_missing' and source_key = any(v_ids::text[]);
  return jsonb_build_object('deleted', cardinality(v_ids), 'fileUrls', to_jsonb(v_files));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. GaramLink import with attachments
-- ---------------------------------------------------------------------------
-- Each message may carry "attachments":[{"id","fileName","fileType","fileSize",
-- "storagePath"|null,"missing":bool}]. The sync copies the file first and
-- passes its path in 'messenger-imported-attachments'. Every attachment becomes
-- its own image/file message right after the text, sharing one batch id.
create or replace function public.messenger_import_request_board_v1(p_payload jsonb)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  u jsonb;
  m jsonb;
  a jsonb;
  v_sender uuid;
  v_peer uuid;
  v_key text;
  v_conversation uuid;
  v_id uuid;
  v_seq bigint;
  v_context jsonb;
  v_batch uuid;
  v_base text;
  v_users integer := 0;
  v_messages integer := 0;
  v_attachments integer := 0;
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
      perform public.messenger_record_issue_once('request_board', (m->>'source') || ':' || (m->>'id'), 'participant_missing');
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

    v_base := 'request_board:' || (m->>'source') || ':' || (m->>'id');
    v_context := case when m->>'requestId' is not null
      then jsonb_build_object('requestBoard', jsonb_build_object('requestId', (m->>'requestId')::bigint)) end;
    v_batch := case when jsonb_array_length(coalesce(m->'attachments', '[]'::jsonb)) > 0
      then md5(v_base || ':batch')::uuid end;
    v_seq := null;

    -- A message that only carries files has no text row of its own.
    if coalesce(m->>'content', '') <> '' or v_batch is null then
      v_id := md5(v_base)::uuid;
      v_seq := public.messenger_append_message(
        v_conversation, v_id, v_sender, null, 'text', m->>'content', (m->>'createdAt')::timestamptz, v_context);
      v_messages := v_messages + 1;
    end if;

    for a in select value from jsonb_array_elements(coalesce(m->'attachments', '[]'::jsonb)) loop
      v_id := md5(v_base || ':att:' || (a->>'id'))::uuid;
      v_seq := public.messenger_append_message(
        v_conversation, v_id, v_sender, null,
        case when a->>'fileType' like 'image/%' then 'image' else 'file' end,
        '', (m->>'createdAt')::timestamptz,
        coalesce(v_context, '{}'::jsonb) || case
          when coalesce((a->>'missing')::boolean, false) or a->>'storagePath' is null
            then jsonb_build_object('importedFile', jsonb_build_object('missing', true))
          else jsonb_build_object('importedFile', jsonb_build_object(
                 'bucket', 'messenger-imported-attachments', 'path', a->>'storagePath', 'mimeType', a->>'fileType'))
        end,
        v_batch, null, a->>'fileName', nullif(a->>'fileSize', '')::bigint);
      v_attachments := v_attachments + 1;
    end loop;

    if coalesce((m->>'isRead')::boolean, false) and v_seq is not null then
      update public.messenger_participants p
         set last_read_seq = greatest(p.last_read_seq, v_seq), updated_at = now()
       where p.conversation_id = v_conversation and p.actor_id = v_peer;
    end if;
  end loop;
  return jsonb_build_object('users', v_users, 'messages', v_messages, 'attachments', v_attachments);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. GaramLink deletions feed
-- ---------------------------------------------------------------------------
-- p_deletions: [{"source","id","deletedAt"}]. A deletion marks the text row and
-- its attachment rows, once, each with a 'delete' event.
create or replace function public.messenger_import_request_board_deletions_batch_v1(
  p_deletions jsonb,
  p_expected_cursor jsonb,
  p_next_cursor jsonb
)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_current jsonb;
  d jsonb;
  r record;
  v_base text;
  v_deleted integer := 0;
begin
  if jsonb_typeof(p_deletions) is distinct from 'array'
     or (p_next_cursor is not null and jsonb_typeof(p_next_cursor) <> 'object') then
    raise exception 'invalid_payload';
  end if;
  insert into public.messenger_import_cursors (source) values ('request_board_deletions') on conflict do nothing;
  select cursor into v_current from public.messenger_import_cursors where source = 'request_board_deletions' for update;
  if v_current is distinct from p_expected_cursor then
    raise exception 'cursor_conflict';
  end if;

  for d in select value from jsonb_array_elements(p_deletions) loop
    v_base := 'request_board:' || (d->>'source') || ':' || (d->>'id');
    for r in
      update public.messenger_messages
         set deleted_at = (d->>'deletedAt')::timestamptz
       where (id = md5(v_base)::uuid or attachment_batch_id = md5(v_base || ':batch')::uuid)
         and deleted_at is null
      returning conversation_id, seq, sender_actor_id
    loop
      perform public.messenger_record_event(r.conversation_id, 'delete', r.seq, r.sender_actor_id);
      v_deleted := v_deleted + 1;
    end loop;
  end loop;

  update public.messenger_import_cursors
     set cursor = coalesce(p_next_cursor, cursor), batches = batches + 1,
         messages = messages + v_deleted, last_imported_at = now(),
         last_error = null, last_error_at = null, updated_at = now()
   where source = 'request_board_deletions';
  return jsonb_build_object('deleted', v_deleted, 'cursor', coalesce(p_next_cursor, v_current));
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily sync: also keep headquarters and repair late rooms before reconciling.
-- Stage 2 must drop the repair call once clients read sequences.
-- ---------------------------------------------------------------------------
create or replace function public.messenger_daily_sync_v1()
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_started timestamptz := clock_timestamp();
  v_backfill jsonb;
  v_headquarters jsonb;
  v_repair jsonb;
  v_reconcile jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtext('messenger_daily_sync_v1')) then
    return jsonb_build_object('skipped', 'already_running');
  end if;

  begin
    v_backfill := public.messenger_backfill_v1();
    v_headquarters := public.messenger_sync_headquarters_v1();
    v_repair := public.messenger_repair_late_conversations_v1();
    v_reconcile := public.messenger_reconcile_v1();
  exception when others then
    insert into public.messenger_reconcile_runs (ok, result)
    values (false, jsonb_build_object('error', sqlerrm, 'sqlstate', sqlstate, 'stage', 'daily_sync'));
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  delete from public.messenger_reconcile_runs where ran_at < now() - interval '180 days';

  return jsonb_build_object(
    'ok', coalesce((v_reconcile->>'ok')::boolean, false),
    'backfill', v_backfill,
    'headquarters', v_headquarters,
    'repair', v_repair,
    'reconcile', v_reconcile,
    'elapsedMs', round(extract(epoch from clock_timestamp() - v_started) * 1000)
  );
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
         'messenger_headquarters_numbers', 'messenger_sync_headquarters_v1',
         'messenger_repair_conversation_order_v1', 'messenger_repair_late_conversations_v1',
         'messenger_orphan_purge_candidates_v1', 'messenger_purge_orphan_messages_v1',
         'messenger_import_request_board_v1', 'messenger_import_request_board_deletions_batch_v1',
         'messenger_daily_sync_v1'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end;
$$;

-- storage --
-- Private bucket for copied GaramLink files; only the service role reaches it.
insert into storage.buckets (id, name, public, file_size_limit)
values ('messenger-imported-attachments', 'messenger-imported-attachments', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
