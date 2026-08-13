begin;

-- Canonicalize the legacy direct-message table before v2 attachment columns are
-- added. Existing rows and public legacy file URLs are preserved for read-only
-- compatibility; all new writes remain service mediated.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id text not null,
  receiver_id text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  is_read boolean not null default false,
  message_type text not null default 'text',
  file_url text,
  file_name text,
  file_size bigint,
  conversation_id uuid references public.garamin_direct_conversations(id) on delete set null,
  sender_actor_id uuid,
  receiver_actor_id uuid
);

alter table public.messages
  add column if not exists file_url text,
  add column if not exists file_name text,
  add column if not exists file_size bigint,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_actor_id uuid;

create table if not exists public.messenger_attachment_delivery_batches (
  id uuid primary key default gen_random_uuid(),
  delivery_key uuid not null,
  payload_fingerprint text not null
    check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null,
  actor_role text not null
    check (actor_role in ('fc', 'admin', 'manager')),
  context_kind text not null
    check (context_kind in ('direct', 'group', 'direct_broadcast')),
  conversation_id uuid references public.garamin_direct_conversations(id) on delete set null,
  room_id uuid references public.group_chat_rooms(id) on delete restrict,
  conversation_ids uuid[],
  generation integer not null default 1 check (generation > 0),
  status text not null default 'pending'
    check (status in ('pending', 'committed', 'expired', 'revoked', 'deleted')),
  expires_at timestamptz not null,
  committed_message_ids uuid[] not null default array[]::uuid[],
  notification_ids uuid[] not null default array[]::uuid[],
  committed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_id, actor_role, delivery_key),
  check (
    (
      context_kind = 'direct'
      and (
        conversation_id is not null
        or status in ('pending', 'expired', 'revoked', 'deleted')
      )
      and room_id is null
      and conversation_ids is null
    )
    or (
      context_kind = 'group'
      and room_id is not null
      and conversation_id is null
      and conversation_ids is null
    )
    or (
      context_kind = 'direct_broadcast'
      and conversation_id is null
      and room_id is null
      and cardinality(conversation_ids) between 1 and 200
    )
  )
);

create table if not exists public.messenger_attachment_upload_intents (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.messenger_attachment_delivery_batches(id) on delete cascade,
  generation integer not null check (generation > 0),
  client_file_id uuid not null,
  sort_order smallint not null check (sort_order between 0 and 9),
  original_name text not null
    check (
      char_length(original_name) between 1 and 255
      and original_name !~ '[[:cntrl:]/\\]'
    ),
  declared_mime_type text not null,
  expected_size bigint not null check (expected_size between 1 and 20971520),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  bucket_id text not null default 'messenger-attachments-v2'
    check (bucket_id = 'messenger-attachments-v2'),
  object_path text,
  status text not null default 'pending'
    check (status in ('pending', 'validated', 'consumed', 'revoked', 'expired')),
  inspected_family text,
  inspected_mime_type text,
  inspected_size bigint,
  inspected_sha256 text,
  expires_at timestamptz not null,
  validated_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, generation, client_file_id),
  unique (batch_id, generation, sort_order),
  check (
    (
      status = 'validated'
      and inspected_family is not null
      and inspected_mime_type is not null
      and inspected_size is not null
      and inspected_sha256 is not null
      and inspected_size = expected_size
      and inspected_sha256 = expected_sha256
      and validated_at is not null
    )
    or status <> 'validated'
  )
);

create unique index if not exists uq_messenger_attachment_upload_intents_path
  on public.messenger_attachment_upload_intents (bucket_id, object_path)
  where object_path is not null;

create table if not exists public.messenger_attachment_objects (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.messenger_attachment_delivery_batches(id) on delete restrict,
  sort_order smallint not null check (sort_order between 0 and 9),
  original_name text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size between 1 and 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  content_family text not null,
  bucket_id text check (bucket_id is null or bucket_id = 'messenger-attachments-v2'),
  storage_path text,
  reference_count integer not null default 1 check (reference_count >= 0),
  status text not null default 'active'
    check (status in ('active', 'tombstoned', 'deleted')),
  created_at timestamptz not null default now(),
  tombstoned_at timestamptz,
  deleted_at timestamptz,
  unique (batch_id, sort_order)
);

create unique index if not exists uq_messenger_attachment_objects_path
  on public.messenger_attachment_objects (bucket_id, storage_path)
  where storage_path is not null;

create table if not exists public.messenger_message_attachments (
  batch_id uuid not null
    references public.messenger_attachment_delivery_batches(id) on delete restrict,
  attachment_id uuid not null
    references public.messenger_attachment_objects(id) on delete restrict,
  sort_order smallint not null check (sort_order between 0 and 9),
  created_at timestamptz not null default now(),
  primary key (batch_id, attachment_id),
  unique (batch_id, sort_order)
);

create table if not exists public.messenger_attachment_cleanup_outbox (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid,
  batch_id uuid,
  bucket_id text,
  storage_path text,
  reason_code text not null,
  sweep_phase text not null check (sweep_phase in ('immediate', 'post_token_expiry')),
  not_before timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 12 check (max_attempts between 1 and 100),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'exhausted')),
  locked_at timestamptz,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status in ('pending', 'processing', 'exhausted') and bucket_id is not null and storage_path is not null)
    or status = 'completed'
  )
);

create unique index if not exists uq_messenger_attachment_cleanup_path_phase
  on public.messenger_attachment_cleanup_outbox (bucket_id, storage_path, sweep_phase)
  where bucket_id is not null and storage_path is not null;

create index if not exists idx_messenger_attachment_cleanup_due
  on public.messenger_attachment_cleanup_outbox (status, not_before, created_at)
  where status in ('pending', 'processing');

create table if not exists public.messenger_attachment_deletion_audit (
  id uuid primary key default gen_random_uuid(),
  original_name text not null,
  byte_size bigint not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  reason_code text not null,
  deleted_at timestamptz not null default now()
);

alter table public.messages
  add column if not exists attachment_batch_id uuid
    references public.messenger_attachment_delivery_batches(id) on delete restrict;

alter table public.group_chat_messages
  add column if not exists attachment_batch_id uuid
    references public.messenger_attachment_delivery_batches(id) on delete restrict;

-- The original table-level check allowed only text or a legacy public URL.
-- Replace that exact generated constraint so an attachment-only v2 message can
-- carry a private batch reference without a public URL.
alter table public.group_chat_messages
  drop constraint if exists group_chat_messages_check;
alter table public.group_chat_messages
  add constraint group_chat_messages_content_or_attachment_check check (
    char_length(trim(content)) > 0
    or (message_type in ('image', 'file') and file_url is not null)
    or attachment_batch_id is not null
  );

create index if not exists idx_messages_attachment_batch
  on public.messages (attachment_batch_id)
  where attachment_batch_id is not null;
create index if not exists idx_group_chat_messages_attachment_batch
  on public.group_chat_messages (attachment_batch_id)
  where attachment_batch_id is not null;
create index if not exists idx_messenger_attachment_batches_actor_pending
  on public.messenger_attachment_delivery_batches (actor_id, actor_role, expires_at)
  where status = 'pending';
create index if not exists idx_messenger_attachment_intents_batch_generation
  on public.messenger_attachment_upload_intents (batch_id, generation, sort_order);
create index if not exists idx_messenger_attachment_objects_batch
  on public.messenger_attachment_objects (batch_id, sort_order);

alter table public.messages enable row level security;
alter table public.messenger_attachment_delivery_batches enable row level security;
alter table public.messenger_attachment_upload_intents enable row level security;
alter table public.messenger_attachment_objects enable row level security;
alter table public.messenger_message_attachments enable row level security;
alter table public.messenger_attachment_cleanup_outbox enable row level security;
alter table public.messenger_attachment_deletion_audit enable row level security;

revoke all privileges on table public.messages
  from public, anon, authenticated, service_role;
revoke all privileges on table public.messenger_attachment_delivery_batches
  from public, anon, authenticated, service_role;
revoke all privileges on table public.messenger_attachment_upload_intents
  from public, anon, authenticated, service_role;
revoke all privileges on table public.messenger_attachment_objects
  from public, anon, authenticated, service_role;
revoke all privileges on table public.messenger_message_attachments
  from public, anon, authenticated, service_role;
revoke all privileges on table public.messenger_attachment_cleanup_outbox
  from public, anon, authenticated, service_role;
revoke all privileges on table public.messenger_attachment_deletion_audit
  from public, anon, authenticated, service_role;

grant select, insert, update, delete
  on table public.messages to service_role;
grant select, insert, update, delete
  on table public.messenger_attachment_delivery_batches to service_role;
grant select, insert, update, delete
  on table public.messenger_attachment_upload_intents to service_role;
grant select, insert, update, delete
  on table public.messenger_attachment_objects to service_role;
grant select, insert, update, delete
  on table public.messenger_message_attachments to service_role;
grant select, insert, update, delete
  on table public.messenger_attachment_cleanup_outbox to service_role;
grant select, insert, update, delete
  on table public.messenger_attachment_deletion_audit to service_role;

do $messages_policies$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename = 'messages'
  loop
    execute format('drop policy if exists %I on public.messages', v_policy.policyname);
  end loop;
end;
$messages_policies$;
create policy "messages service role only"
  on public.messages
  for all to service_role using (true) with check (true);

drop policy if exists "messenger attachment batches service role"
  on public.messenger_attachment_delivery_batches;
create policy "messenger attachment batches service role"
  on public.messenger_attachment_delivery_batches
  for all to service_role using (true) with check (true);
drop policy if exists "messenger attachment intents service role"
  on public.messenger_attachment_upload_intents;
create policy "messenger attachment intents service role"
  on public.messenger_attachment_upload_intents
  for all to service_role using (true) with check (true);
drop policy if exists "messenger attachment objects service role"
  on public.messenger_attachment_objects;
create policy "messenger attachment objects service role"
  on public.messenger_attachment_objects
  for all to service_role using (true) with check (true);
drop policy if exists "messenger message attachments service role"
  on public.messenger_message_attachments;
create policy "messenger message attachments service role"
  on public.messenger_message_attachments
  for all to service_role using (true) with check (true);
drop policy if exists "messenger attachment cleanup service role"
  on public.messenger_attachment_cleanup_outbox;
create policy "messenger attachment cleanup service role"
  on public.messenger_attachment_cleanup_outbox
  for all to service_role using (true) with check (true);
drop policy if exists "messenger attachment audit service role"
  on public.messenger_attachment_deletion_audit;
create policy "messenger attachment audit service role"
  on public.messenger_attachment_deletion_audit
  for all to service_role using (true) with check (true);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'messenger-attachments-v2',
  'messenger-attachments-v2',
  false,
  20971520,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'image/heic',
    'image/heif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "messenger attachments v2 service read" on storage.objects;
create policy "messenger attachments v2 service read"
  on storage.objects for select to service_role
  using (bucket_id = 'messenger-attachments-v2');
drop policy if exists "messenger attachments v2 service insert" on storage.objects;
create policy "messenger attachments v2 service insert"
  on storage.objects for insert to service_role
  with check (bucket_id = 'messenger-attachments-v2');
drop policy if exists "messenger attachments v2 service update" on storage.objects;
create policy "messenger attachments v2 service update"
  on storage.objects for update to service_role
  using (bucket_id = 'messenger-attachments-v2')
  with check (bucket_id = 'messenger-attachments-v2');
drop policy if exists "messenger attachments v2 service delete" on storage.objects;
create policy "messenger attachments v2 service delete"
  on storage.objects for delete to service_role
  using (bucket_id = 'messenger-attachments-v2');

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
  v_now timestamptz := clock_timestamp();
  v_expires_at timestamptz := v_now + interval '2 hours';
  v_context_kind text;
  v_conversation_id uuid;
  v_room_id uuid;
  v_conversation_ids uuid[];
  v_actor_phone text;
  v_actor_valid boolean := false;
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_file jsonb;
  v_file_count integer;
  v_file_bytes bigint := 0;
  v_order integer := 0;
  v_client_file_id uuid;
  v_name text;
  v_size bigint;
  v_mime text;
  v_sha256 text;
  v_extension text;
  v_expected_mime text;
  v_canonical_files jsonb := '[]'::jsonb;
  v_existing_files jsonb;
  v_active_files bigint;
  v_active_bytes bigint;
  v_recent_files bigint;
  v_recent_batches bigint;
  v_generation integer;
  v_intent_id uuid;
  v_lock_conversation_id uuid;
  v_context_canonical jsonb;
  v_result_intents jsonb;
begin
  if p_actor_id is null
     or p_delivery_key is null
     or p_actor_role not in ('fc', 'admin', 'manager')
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_context is null
     or jsonb_typeof(p_context) <> 'object'
     or p_files is null
     or jsonb_typeof(p_files) <> 'array' then
    raise exception 'invalid_attachment_intent_request';
  end if;

  -- Serialize quota accounting per immutable actor. Concurrent signed-intent
  -- creation cannot race past the active-byte/file or issuance-window limits.
  perform pg_advisory_xact_lock(
    hashtextextended(p_actor_role || ':' || p_actor_id::text, 0)
  );

  if p_actor_role = 'fc' then
    select profile.phone,
           profile.signup_completed = true
           and coalesce(profile.is_manager_referral_shadow, false) = false
           and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
           and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
      into v_actor_phone, v_actor_valid
      from public.fc_profiles profile
     where profile.id = p_actor_id;
  elsif p_actor_role = 'manager' then
    select account.phone, account.active = true
      into v_actor_phone, v_actor_valid
      from public.manager_accounts account
     where account.id = p_actor_id;
  else
    select account.phone,
           account.active = true
           and coalesce(account.staff_type, 'admin') in ('admin', 'developer')
      into v_actor_phone, v_actor_valid
      from public.admin_accounts account
     where account.id = p_actor_id;
  end if;
  if not coalesce(v_actor_valid, false) then
    raise exception 'attachment_actor_not_active';
  end if;

  v_context_kind := p_context->>'kind';
  if v_context_kind = 'direct' then
    begin
      v_conversation_id := (p_context->>'conversationId')::uuid;
    exception when others then
      raise exception 'invalid_attachment_context';
    end;
    perform pg_advisory_xact_lock(
      hashtextextended(
        'messenger-direct-context:' || v_conversation_id::text,
        0
      )
    );
    if not exists (
         select 1
           from public.garamin_direct_conversations conversation
           join public.fc_profiles profile
             on profile.id = conversation.fc_id
            and profile.signup_completed = true
            and coalesce(profile.is_manager_referral_shadow, false) = false
            and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
            and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
          where conversation.id = v_conversation_id
            and (
              p_actor_role in ('admin', 'manager')
              or (p_actor_role = 'fc' and conversation.fc_id = p_actor_id)
            )
       ) then
      raise exception 'attachment_context_forbidden';
    end if;
    v_context_canonical := jsonb_build_object(
      'kind', 'direct',
      'conversationId', v_conversation_id::text
    );
  elsif v_context_kind = 'group' then
    begin
      v_room_id := (p_context->>'roomId')::uuid;
    exception when others then
      raise exception 'invalid_attachment_context';
    end;
    if not exists (
      select 1 from public.group_chat_rooms room
       where room.id = v_room_id and room.is_active = true
    ) then
      raise exception 'attachment_context_not_found';
    end if;
    if p_actor_role = 'fc'
       and not exists (
         select 1
           from public.group_chat_member_send_permissions permission
          where permission.room_id = v_room_id
            and permission.actor_id = 'fc:' || regexp_replace(v_actor_phone, '[^0-9]', '', 'g')
            and permission.can_send_messages = true
       ) then
      raise exception 'attachment_context_forbidden';
    end if;
    v_context_canonical := jsonb_build_object(
      'kind', 'group',
      'roomId', v_room_id::text
    );
  elsif v_context_kind = 'direct_broadcast' then
    if p_actor_role <> 'admin'
       or jsonb_typeof(p_context->'conversationIds') <> 'array'
       or jsonb_array_length(p_context->'conversationIds') not between 1 and 200 then
      raise exception 'attachment_context_forbidden';
    end if;
    begin
      select array_agg(value::uuid order by value::uuid)
        into v_conversation_ids
        from (
          select distinct jsonb_array_elements_text(p_context->'conversationIds') as value
        ) requested;
    exception when others then
      raise exception 'invalid_attachment_context';
    end;
    for v_lock_conversation_id in
      select conversation_id
        from unnest(v_conversation_ids) requested(conversation_id)
       order by conversation_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended(
          'messenger-direct-context:' || v_lock_conversation_id::text,
          0
        )
      );
    end loop;
    if cardinality(v_conversation_ids) <> jsonb_array_length(p_context->'conversationIds')
       or exists (
         select 1
           from unnest(v_conversation_ids) requested(conversation_id)
           left join public.garamin_direct_conversations conversation
             on conversation.id = requested.conversation_id
           left join public.fc_profiles profile
             on profile.id = conversation.fc_id
            and profile.signup_completed = true
            and coalesce(profile.is_manager_referral_shadow, false) = false
            and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
            and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
          where conversation.id is null or profile.id is null
       ) then
      raise exception 'attachment_context_not_found';
    end if;
    v_context_canonical := jsonb_build_object(
      'kind', 'direct_broadcast',
      'conversationIds', to_jsonb(v_conversation_ids)
    );
  else
    raise exception 'invalid_attachment_context';
  end if;

  v_file_count := jsonb_array_length(p_files);
  if v_file_count not between 1 and 10 then
    raise exception 'invalid_attachment_file_count';
  end if;

  for v_file in select value from jsonb_array_elements(p_files)
  loop
    begin
      v_client_file_id := (v_file->>'clientFileId')::uuid;
      v_size := (v_file->>'size')::bigint;
    exception when others then
      raise exception 'invalid_attachment_file_metadata';
    end;
    v_name := normalize(v_file->>'name', NFC);
    v_mime := lower(btrim(v_file->>'mimeType'));
    v_sha256 := lower(btrim(v_file->>'sha256'));
    v_extension := lower(substring(v_name from '(\.[^.]+)$'));
    v_expected_mime := case v_extension
      when '.jpg' then 'image/jpeg'
      when '.jpeg' then 'image/jpeg'
      when '.png' then 'image/png'
      when '.webp' then 'image/webp'
      when '.gif' then 'image/gif'
      when '.bmp' then 'image/bmp'
      when '.heic' then 'image/heic'
      when '.heif' then 'image/heif'
      when '.pdf' then 'application/pdf'
      when '.doc' then 'application/msword'
      when '.docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      when '.xls' then 'application/vnd.ms-excel'
      when '.xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      when '.ppt' then 'application/vnd.ms-powerpoint'
      when '.pptx' then 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      when '.txt' then 'text/plain'
      else null
    end;
    if v_name is null
       or char_length(v_name) not between 1 and 255
       or v_name ~ '[[:cntrl:]/\\]'
       or v_size not between 1 and 20971520
       or v_sha256 !~ '^[0-9a-f]{64}$'
       or v_expected_mime is null
       or v_mime <> v_expected_mime then
      raise exception 'invalid_attachment_file_metadata';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(v_canonical_files) existing
       where existing->>'clientFileId' = v_client_file_id::text
    ) then
      raise exception 'invalid_attachment_duplicate_file';
    end if;
    v_file_bytes := v_file_bytes + v_size;
    v_canonical_files := v_canonical_files || jsonb_build_array(jsonb_build_object(
      'clientFileId', v_client_file_id::text,
      'name', v_name,
      'size', v_size,
      'mimeType', v_mime,
      'sha256', v_sha256,
      'order', v_order
    ));
    v_order := v_order + 1;
  end loop;

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_actor_id
     and batch.actor_role = p_actor_role
     and batch.delivery_key = p_delivery_key
   for update;

  if v_batch.id is not null then
    if v_batch.payload_fingerprint is distinct from p_payload_fingerprint
       or v_batch.context_kind <> v_context_kind
       or v_batch.conversation_id is distinct from v_conversation_id
       or v_batch.room_id is distinct from v_room_id
       or v_batch.conversation_ids is distinct from v_conversation_ids then
      raise exception 'attachment_idempotency_conflict';
    end if;
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'clientFileId', intent.client_file_id::text,
          'name', intent.original_name,
          'size', intent.expected_size,
          'mimeType', intent.declared_mime_type,
          'sha256', intent.expected_sha256,
          'order', intent.sort_order
        )
        order by intent.sort_order
      ),
      '[]'::jsonb
    )
      into v_existing_files
      from public.messenger_attachment_upload_intents intent
     where intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation;
    if v_existing_files <> v_canonical_files then
      raise exception 'attachment_idempotency_conflict';
    end if;
    if v_batch.status = 'committed' then
      return jsonb_build_object(
        'state', 'committed',
        'batchId', v_batch.id,
        'deliveryKey', v_batch.delivery_key,
        'payloadFingerprint', v_batch.payload_fingerprint,
        'messageIds', to_jsonb(v_batch.committed_message_ids)
      );
    end if;
    if v_batch.status = 'pending' and v_batch.expires_at > v_now then
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', intent.id,
            'clientFileId', intent.client_file_id,
            'order', intent.sort_order,
            'bucket', intent.bucket_id,
            'path', intent.object_path
          )
          order by intent.sort_order
        ),
        '[]'::jsonb
      )
        into v_result_intents
        from public.messenger_attachment_upload_intents intent
       where intent.batch_id = v_batch.id
         and intent.generation = v_batch.generation
         and intent.status in ('pending', 'validated');
      return jsonb_build_object(
        'state', 'pending',
        'batchId', v_batch.id,
        'deliveryKey', v_batch.delivery_key,
        'payloadFingerprint', v_batch.payload_fingerprint,
        'expiresAt', v_batch.expires_at,
        'intents', v_result_intents
      );
    end if;
    if v_batch.status in ('revoked', 'deleted') then
      raise exception 'attachment_idempotency_conflict';
    end if;

    insert into public.messenger_attachment_cleanup_outbox (
      batch_id, bucket_id, storage_path, reason_code, sweep_phase, not_before
    )
    select intent.batch_id,
           intent.bucket_id,
           intent.object_path,
           'expired_or_renewed_intent',
           phase.sweep_phase,
           case phase.sweep_phase
             when 'immediate' then v_now
             else greatest(intent.expires_at, v_now) + interval '5 minutes'
           end
      from public.messenger_attachment_upload_intents intent
      cross join (
        values ('immediate'::text), ('post_token_expiry'::text)
      ) phase(sweep_phase)
     where intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation
       and intent.object_path is not null
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
       set status = 'expired',
           object_path = null,
           updated_at = v_now
     where batch_id = v_batch.id
       and generation = v_batch.generation;
    v_generation := v_batch.generation + 1;
  else
    v_generation := 1;
  end if;

  select count(*), coalesce(sum(intent.expected_size), 0)
    into v_active_files, v_active_bytes
    from public.messenger_attachment_upload_intents intent
    join public.messenger_attachment_delivery_batches batch
      on batch.id = intent.batch_id
   where batch.actor_id = p_actor_id
     and batch.actor_role = p_actor_role
     and batch.status = 'pending'
     and batch.expires_at > v_now
     and (v_batch.id is null or batch.id <> v_batch.id)
     and intent.status in ('pending', 'validated');
  if v_active_files + v_file_count > 50
     or v_active_bytes + v_file_bytes > 209715200 then
    raise exception 'attachment_active_quota_exceeded';
  end if;

  select count(*),
         count(distinct intent.batch_id::text || ':' || intent.generation::text)
    into v_recent_files, v_recent_batches
    from public.messenger_attachment_upload_intents intent
    join public.messenger_attachment_delivery_batches batch
      on batch.id = intent.batch_id
   where batch.actor_id = p_actor_id
     and batch.actor_role = p_actor_role
     and intent.created_at >= v_now - interval '1 hour';
  if v_recent_files + v_file_count > 100
     or v_recent_batches + 1 > 20 then
    raise exception 'attachment_intent_rate_limited';
  end if;

  if v_batch.id is null then
    insert into public.messenger_attachment_delivery_batches (
      delivery_key,
      payload_fingerprint,
      actor_id,
      actor_role,
      context_kind,
      conversation_id,
      room_id,
      conversation_ids,
      generation,
      status,
      expires_at,
      created_at,
      updated_at
    )
    values (
      p_delivery_key,
      p_payload_fingerprint,
      p_actor_id,
      p_actor_role,
      v_context_kind,
      v_conversation_id,
      v_room_id,
      v_conversation_ids,
      v_generation,
      'pending',
      v_expires_at,
      v_now,
      v_now
    )
    returning * into v_batch;
  else
    update public.messenger_attachment_delivery_batches
       set generation = v_generation,
           status = 'pending',
           expires_at = v_expires_at,
           updated_at = v_now
     where id = v_batch.id
    returning * into v_batch;
  end if;

  for v_file in select value from jsonb_array_elements(v_canonical_files)
  loop
    v_intent_id := gen_random_uuid();
    insert into public.messenger_attachment_upload_intents (
      id,
      batch_id,
      generation,
      client_file_id,
      sort_order,
      original_name,
      declared_mime_type,
      expected_size,
      expected_sha256,
      bucket_id,
      object_path,
      status,
      expires_at,
      created_at,
      updated_at
    )
    values (
      v_intent_id,
      v_batch.id,
      v_generation,
      (v_file->>'clientFileId')::uuid,
      (v_file->>'order')::smallint,
      v_file->>'name',
      v_file->>'mimeType',
      (v_file->>'size')::bigint,
      v_file->>'sha256',
      'messenger-attachments-v2',
      'uploads/' || v_batch.id::text || '/' || v_generation::text || '/' || v_intent_id::text,
      'pending',
      v_expires_at,
      v_now,
      v_now
    );
  end loop;

  select jsonb_agg(
    jsonb_build_object(
      'id', intent.id,
      'clientFileId', intent.client_file_id,
      'order', intent.sort_order,
      'bucket', intent.bucket_id,
      'path', intent.object_path
    )
    order by intent.sort_order
  )
    into v_result_intents
    from public.messenger_attachment_upload_intents intent
   where intent.batch_id = v_batch.id
     and intent.generation = v_generation;

  return jsonb_build_object(
    'state', 'pending',
    'batchId', v_batch.id,
    'deliveryKey', v_batch.delivery_key,
    'payloadFingerprint', v_batch.payload_fingerprint,
    'expiresAt', v_batch.expires_at,
    'intents', coalesce(v_result_intents, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.reserve_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text, jsonb, jsonb
) to service_role;

create or replace function public.validate_messenger_attachment_intents_v2(
  p_actor_id uuid,
  p_actor_role text,
  p_delivery_key uuid,
  p_payload_fingerprint text,
  p_intents jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_expected_count integer;
  v_item jsonb;
  v_intent_id uuid;
  v_size bigint;
  v_mime text;
  v_sha256 text;
  v_family text;
  v_updated integer := 0;
begin
  if p_actor_id is null
     or p_delivery_key is null
     or p_actor_role not in ('fc', 'admin', 'manager')
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_intents is null
     or jsonb_typeof(p_intents) <> 'array'
     or jsonb_array_length(p_intents) not between 1 and 10 then
    raise exception 'invalid_attachment_validation_request';
  end if;

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_actor_id
     and batch.actor_role = p_actor_role
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.payload_fingerprint is distinct from p_payload_fingerprint then
    raise exception 'attachment_idempotency_conflict';
  end if;
  if v_batch.status = 'committed' then
    return jsonb_build_object(
      'state', 'committed',
      'batchId', v_batch.id,
      'messageIds', to_jsonb(v_batch.committed_message_ids)
    );
  end if;
  if v_batch.status <> 'pending' then
    raise exception 'attachment_intent_consumed';
  end if;
  if v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  select count(*)
    into v_expected_count
    from public.messenger_attachment_upload_intents intent
   where intent.batch_id = v_batch.id
     and intent.generation = v_batch.generation
     and intent.status in ('pending', 'validated');
  if v_expected_count <> jsonb_array_length(p_intents) then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  for v_item in select value from jsonb_array_elements(p_intents)
  loop
    begin
      v_intent_id := (v_item->>'id')::uuid;
      v_size := (v_item->>'size')::bigint;
    exception when others then
      raise exception 'invalid_attachment_validation_request';
    end;
    v_mime := lower(btrim(v_item->>'mimeType'));
    v_sha256 := lower(btrim(v_item->>'sha256'));
    v_family := lower(btrim(v_item->>'family'));
    update public.messenger_attachment_upload_intents intent
       set status = 'validated',
           inspected_family = v_family,
           inspected_mime_type = v_mime,
           inspected_size = v_size,
           inspected_sha256 = v_sha256,
           validated_at = coalesce(intent.validated_at, v_now),
           updated_at = v_now
     where intent.id = v_intent_id
       and intent.batch_id = v_batch.id
       and intent.generation = v_batch.generation
       and intent.status in ('pending', 'validated')
       and intent.expected_size = v_size
       and intent.declared_mime_type = v_mime
       and intent.expected_sha256 = v_sha256
       and intent.object_path is not null;
    if not found then
      raise exception 'attachment_intent_validation_mismatch';
    end if;
    v_updated := v_updated + 1;
  end loop;

  if v_updated <> v_expected_count
     or (
       select count(*)
         from public.messenger_attachment_upload_intents intent
        where intent.batch_id = v_batch.id
          and intent.generation = v_batch.generation
          and intent.status = 'validated'
     ) <> v_expected_count then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  return jsonb_build_object(
    'state', 'validated',
    'batchId', v_batch.id,
    'intentCount', v_updated
  );
end;
$$;

revoke all on function public.validate_messenger_attachment_intents_v2(
  uuid, text, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.validate_messenger_attachment_intents_v2(
  uuid, text, uuid, text, jsonb
) to service_role;

create or replace function public.revoke_messenger_attachment_upload_batch_v2(
  p_actor_id uuid,
  p_actor_role text,
  p_delivery_key uuid,
  p_reason_code text default 'upload_intent_revoked'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_scheduled integer := 0;
  v_retryable boolean := p_reason_code in (
    'signed_upload_response_invalid',
    'signed_upload_url_failed'
  );
begin
  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_actor_id
     and batch.actor_role = p_actor_role
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    return jsonb_build_object('revoked', false, 'scheduled', 0);
  end if;
  if v_batch.status = 'committed' then
    raise exception 'attachment_intent_consumed';
  end if;
  if v_batch.status in ('revoked', 'deleted') then
    return jsonb_build_object('revoked', false, 'scheduled', 0);
  end if;

  insert into public.messenger_attachment_cleanup_outbox (
    batch_id, bucket_id, storage_path, reason_code, sweep_phase, not_before
  )
  select intent.batch_id,
         intent.bucket_id,
         intent.object_path,
         left(coalesce(nullif(p_reason_code, ''), 'upload_intent_revoked'), 80),
         phase.sweep_phase,
         case phase.sweep_phase
           when 'immediate' then v_now
           else greatest(intent.expires_at, v_now) + interval '5 minutes'
         end
    from public.messenger_attachment_upload_intents intent
    cross join (
      values ('immediate'::text), ('post_token_expiry'::text)
    ) phase(sweep_phase)
   where intent.batch_id = v_batch.id
     and intent.generation = v_batch.generation
     and intent.object_path is not null
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
  get diagnostics v_scheduled = row_count;

  update public.messenger_attachment_upload_intents
     set status = case when v_retryable then 'expired' else 'revoked' end,
         object_path = null,
         updated_at = v_now
   where batch_id = v_batch.id
     and generation = v_batch.generation;
  update public.messenger_attachment_delivery_batches
     set status = case when v_retryable then 'expired' else 'revoked' end,
         updated_at = v_now
   where id = v_batch.id;

  return jsonb_build_object(
    'revoked', not v_retryable,
    'retryable', v_retryable,
    'scheduled', v_scheduled
  );
end;
$$;

revoke all on function public.revoke_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.revoke_messenger_attachment_upload_batch_v2(
  uuid, text, uuid, text
) to service_role;

create or replace function public.materialize_messenger_attachment_batch_v2(
  p_batch_id uuid,
  p_reference_count integer
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_expected_count integer;
  v_attachment_rows jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_batch_id is null or p_reference_count not between 1 and 200 then
    raise exception 'invalid_attachment_materialization';
  end if;
  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.id = p_batch_id
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.status = 'committed' then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', attachment.id,
          'name', attachment.original_name,
          'size', attachment.byte_size,
          'mimeType', attachment.mime_type,
          'sha256', attachment.sha256
        )
        order by link.sort_order
      ),
      '[]'::jsonb
    )
      into v_attachment_rows
      from public.messenger_message_attachments link
      join public.messenger_attachment_objects attachment
        on attachment.id = link.attachment_id
     where link.batch_id = v_batch.id;
    return v_attachment_rows;
  end if;
  if v_batch.status <> 'pending' or v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  select count(*)
    into v_expected_count
    from public.messenger_attachment_upload_intents intent
   where intent.batch_id = v_batch.id
     and intent.generation = v_batch.generation
     and intent.status = 'validated'
     and intent.object_path is not null;
  if v_expected_count not between 1 and 10
     or v_expected_count <> (
       select count(*)
         from public.messenger_attachment_upload_intents intent
        where intent.batch_id = v_batch.id
          and intent.generation = v_batch.generation
     ) then
    raise exception 'attachment_intent_set_mismatch';
  end if;

  insert into public.messenger_attachment_objects (
    id,
    batch_id,
    sort_order,
    original_name,
    mime_type,
    byte_size,
    sha256,
    content_family,
    bucket_id,
    storage_path,
    reference_count,
    status,
    created_at
  )
  select gen_random_uuid(),
         intent.batch_id,
         intent.sort_order,
         intent.original_name,
         intent.inspected_mime_type,
         intent.inspected_size,
         intent.inspected_sha256,
         intent.inspected_family,
         intent.bucket_id,
         intent.object_path,
         p_reference_count,
         'active',
         v_now
    from public.messenger_attachment_upload_intents intent
   where intent.batch_id = v_batch.id
     and intent.generation = v_batch.generation
     and intent.status = 'validated'
   order by intent.sort_order
  on conflict (batch_id, sort_order) do update
    set reference_count = excluded.reference_count;

  insert into public.messenger_message_attachments (
    batch_id,
    attachment_id,
    sort_order
  )
  select attachment.batch_id, attachment.id, attachment.sort_order
    from public.messenger_attachment_objects attachment
   where attachment.batch_id = v_batch.id
  on conflict (batch_id, attachment_id) do nothing;

  update public.messenger_attachment_upload_intents
     set status = 'consumed',
         consumed_at = v_now,
         object_path = null,
         updated_at = v_now
   where batch_id = v_batch.id
     and generation = v_batch.generation
     and status = 'validated';

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', attachment.id,
        'name', attachment.original_name,
        'size', attachment.byte_size,
        'mimeType', attachment.mime_type,
        'sha256', attachment.sha256
      )
      order by link.sort_order
    ),
    '[]'::jsonb
  )
    into v_attachment_rows
    from public.messenger_message_attachments link
    join public.messenger_attachment_objects attachment
      on attachment.id = link.attachment_id
   where link.batch_id = v_batch.id;
  return v_attachment_rows;
end;
$$;

revoke all on function public.materialize_messenger_attachment_batch_v2(
  uuid, integer
) from public, anon, authenticated;
grant execute on function public.materialize_messenger_attachment_batch_v2(
  uuid, integer
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
  v_fc_id uuid;
  v_fc_phone text;
  v_actor_role text;
  v_staff_phone text;
  v_staff_type text;
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_existing_message public.messages%rowtype;
  v_attachments jsonb;
  v_notifications jsonb;
  v_notification_ids uuid[];
begin
  if p_message_id is null
     or p_conversation_id is null
     or p_sender_actor_id is null
     or p_delivery_key is null
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_attachment_intent_ids is null
     or cardinality(p_attachment_intent_ids) not between 1 and 10
     or length(coalesce(p_content, '')) > 4000 then
    raise exception 'invalid_direct_attachment_message';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'messenger-direct-context:' || p_conversation_id::text,
      0
    )
  );

  select conversation.fc_id, profile.phone
    into v_fc_id, v_fc_phone
    from public.garamin_direct_conversations conversation
    join public.fc_profiles profile
      on profile.id = conversation.fc_id
     and profile.signup_completed = true
     and coalesce(profile.is_manager_referral_shadow, false) = false
     and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
     and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
   where conversation.id = p_conversation_id;
  if v_fc_id is null or v_fc_phone is null then
    raise exception 'direct_conversation_not_found';
  end if;

  if p_sender_id = v_fc_phone and p_receiver_id = 'admin' then
    v_actor_role := 'fc';
    if p_sender_actor_id <> v_fc_id
       or p_receiver_actor_id is not null
       or not exists (
         select 1 from public.fc_profiles profile
          where profile.id = p_sender_actor_id
            and profile.signup_completed = true
            and coalesce(profile.is_manager_referral_shadow, false) = false
            and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
            and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
       )
       or not exists (
         select 1 from public.admin_accounts account
          where account.active = true
            and coalesce(account.staff_type, 'admin') in ('admin', 'developer')
       ) then
      raise exception 'direct_message_actor_mismatch';
    end if;
  elsif p_receiver_id = v_fc_phone then
    if p_receiver_actor_id is distinct from v_fc_id then
      raise exception 'direct_message_actor_mismatch';
    end if;
    select account.phone, coalesce(account.staff_type, 'admin')
      into v_staff_phone, v_staff_type
      from public.admin_accounts account
     where account.id = p_sender_actor_id
       and account.active = true
       and coalesce(account.staff_type, 'admin') in ('admin', 'developer');
    if found then
      v_actor_role := 'admin';
      if p_sender_id is distinct from (
        case
          when v_staff_type = 'developer'
            then regexp_replace(v_staff_phone, '[^0-9]', '', 'g')
          else 'admin'
        end
      ) then
        raise exception 'direct_message_actor_mismatch';
      end if;
    else
      v_staff_phone := null;
      select account.phone
        into v_staff_phone
        from public.manager_accounts account
       where account.id = p_sender_actor_id
         and account.active = true;
      if not found
         or p_sender_id is distinct from regexp_replace(v_staff_phone, '[^0-9]', '', 'g') then
        raise exception 'direct_message_actor_mismatch';
      end if;
      v_actor_role := 'manager';
    end if;
  else
    raise exception 'direct_message_identity_mismatch';
  end if;

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_sender_actor_id
     and batch.actor_role = v_actor_role
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.payload_fingerprint is distinct from p_payload_fingerprint
     or v_batch.context_kind <> 'direct'
     or v_batch.conversation_id <> p_conversation_id then
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
       or v_existing_message.conversation_id <> p_conversation_id
       or v_existing_message.sender_actor_id <> p_sender_actor_id
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
      'attachments', public.materialize_messenger_attachment_batch_v2(v_batch.id, 1),
      'notifications', v_notifications
    );
  end if;
  if v_batch.status <> 'pending' or v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  v_attachments := public.materialize_messenger_attachment_batch_v2(v_batch.id, 1);

  insert into public.messages (
    id,
    conversation_id,
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
    p_conversation_id,
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
     or v_existing_message.conversation_id <> p_conversation_id
     or v_existing_message.sender_actor_id <> p_sender_actor_id
     or v_existing_message.receiver_actor_id is distinct from p_receiver_actor_id
     or v_existing_message.content is distinct from coalesce(p_content, '')
     or v_existing_message.attachment_batch_id <> v_batch.id then
    raise exception 'attachment_idempotency_conflict';
  end if;

  if p_receiver_id = 'admin' then
    with inserted as (
      insert into public.notifications (
        title, body, category, fc_id, resident_id, recipient_actor_id,
        recipient_role, target, target_url, delivery_key
      )
      select '새 메시지',
             left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
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
         and coalesce(account.staff_type, 'admin') in ('admin', 'developer')
      on conflict (delivery_key) do update
        set delivery_key = excluded.delivery_key
      returning *
    )
    select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.id), '[]'::jsonb),
           coalesce(array_agg(inserted.id order by inserted.id), array[]::uuid[])
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

create or replace function public.commit_group_chat_message_with_attachments_v2(
  p_message_id uuid,
  p_room_id uuid,
  p_sender_immutable_actor_id uuid,
  p_sender_actor_id text,
  p_sender_role text,
  p_sender_phone text,
  p_sender_name text,
  p_content text,
  p_reply_to_message_id uuid,
  p_reply_to_sender_name text,
  p_reply_to_content text,
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
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_actor_valid boolean := false;
  v_actor_phone text;
  v_existing_message public.group_chat_messages%rowtype;
  v_attachments jsonb;
begin
  if p_message_id is null
     or p_room_id is null
     or p_sender_immutable_actor_id is null
     or p_sender_role not in ('fc', 'manager', 'admin')
     or p_delivery_key is null
     or p_payload_fingerprint is null
     or p_payload_fingerprint !~ '^[0-9a-f]{64}$'
     or p_attachment_intent_ids is null
     or cardinality(p_attachment_intent_ids) not between 1 and 10
     or length(coalesce(p_content, '')) > 4000 then
    raise exception 'invalid_group_attachment_message';
  end if;

  if p_sender_role = 'fc' then
    select profile.phone,
           profile.signup_completed = true
           and coalesce(profile.is_manager_referral_shadow, false) = false
           and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
           and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
      into v_actor_phone, v_actor_valid
      from public.fc_profiles profile
     where profile.id = p_sender_immutable_actor_id;
  elsif p_sender_role = 'manager' then
    select account.phone, account.active = true
      into v_actor_phone, v_actor_valid
      from public.manager_accounts account
     where account.id = p_sender_immutable_actor_id;
  else
    select account.phone,
           account.active = true
           and coalesce(account.staff_type, 'admin') in ('admin', 'developer')
      into v_actor_phone, v_actor_valid
      from public.admin_accounts account
     where account.id = p_sender_immutable_actor_id;
  end if;
  if not coalesce(v_actor_valid, false)
     or regexp_replace(v_actor_phone, '[^0-9]', '', 'g')
        <> regexp_replace(coalesce(p_sender_phone, ''), '[^0-9]', '', 'g')
     or p_sender_actor_id is distinct from (
       p_sender_role || ':' || regexp_replace(v_actor_phone, '[^0-9]', '', 'g')
     )
     or not exists (
       select 1 from public.group_chat_rooms room
        where room.id = p_room_id and room.is_active = true
     ) then
    raise exception 'attachment_context_forbidden';
  end if;
  if p_sender_role = 'fc'
     and not exists (
       select 1
         from public.group_chat_member_send_permissions permission
        where permission.room_id = p_room_id
          and permission.actor_id = p_sender_actor_id
          and permission.can_send_messages = true
     ) then
    raise exception 'attachment_context_forbidden';
  end if;

  select *
    into v_batch
    from public.messenger_attachment_delivery_batches batch
   where batch.actor_id = p_sender_immutable_actor_id
     and batch.actor_role = p_sender_role
     and batch.delivery_key = p_delivery_key
   for update;
  if v_batch.id is null then
    raise exception 'attachment_intent_not_found';
  end if;
  if v_batch.payload_fingerprint is distinct from p_payload_fingerprint
     or v_batch.context_kind <> 'group'
     or v_batch.room_id <> p_room_id then
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
      from public.group_chat_messages message
     where message.id = p_message_id
       and message.attachment_batch_id = v_batch.id;
    if v_existing_message.id is null
       or v_existing_message.room_id <> p_room_id
       or v_existing_message.sender_actor_id <> p_sender_actor_id
       or v_existing_message.content is distinct from coalesce(p_content, '') then
      raise exception 'attachment_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'message_id', p_message_id,
      'batch_id', v_batch.id,
      'replayed', true,
      'attachments', public.materialize_messenger_attachment_batch_v2(v_batch.id, 1)
    );
  end if;
  if v_batch.status <> 'pending' or v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  v_attachments := public.materialize_messenger_attachment_batch_v2(v_batch.id, 1);
  insert into public.group_chat_messages (
    id,
    room_id,
    sender_actor_id,
    sender_role,
    sender_phone,
    sender_name,
    content,
    message_type,
    file_url,
    file_name,
    file_size,
    reply_to_message_id,
    reply_to_sender_name,
    reply_to_content,
    attachment_batch_id
  )
  values (
    p_message_id,
    p_room_id,
    p_sender_actor_id,
    p_sender_role,
    p_sender_phone,
    nullif(p_sender_name, ''),
    coalesce(p_content, ''),
    'file',
    null,
    null,
    null,
    p_reply_to_message_id,
    nullif(p_reply_to_sender_name, ''),
    nullif(p_reply_to_content, ''),
    v_batch.id
  )
  on conflict (id) do nothing;

  select *
    into v_existing_message
    from public.group_chat_messages message
   where message.id = p_message_id;
  if v_existing_message.id is null
     or v_existing_message.room_id <> p_room_id
     or v_existing_message.sender_actor_id <> p_sender_actor_id
     or v_existing_message.content is distinct from coalesce(p_content, '')
     or v_existing_message.attachment_batch_id <> v_batch.id then
    raise exception 'attachment_idempotency_conflict';
  end if;

  update public.messenger_attachment_delivery_batches
     set status = 'committed',
         committed_message_ids = array[p_message_id],
         committed_at = v_now,
         updated_at = v_now
   where id = v_batch.id;

  return jsonb_build_object(
    'message_id', p_message_id,
    'batch_id', v_batch.id,
    'replayed', false,
    'attachments', v_attachments
  );
end;
$$;

revoke all on function public.commit_group_chat_message_with_attachments_v2(
  uuid, uuid, uuid, text, text, text, text, text,
  uuid, text, text, uuid, text, uuid[]
) from public, anon, authenticated;
grant execute on function public.commit_group_chat_message_with_attachments_v2(
  uuid, uuid, uuid, text, text, text, text, text,
  uuid, text, text, uuid, text, uuid[]
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
  v_batch public.messenger_attachment_delivery_batches%rowtype;
  v_sorted_conversation_ids uuid[];
  v_sender_phone text;
  v_sender_staff_type text;
  v_sender_id text;
  v_lock_conversation_id uuid;
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
     or cardinality(array(select distinct value from unnest(p_conversation_ids) value)) <> v_count
     or cardinality(array(select distinct value from unnest(p_message_ids) value)) <> v_count
     or not exists (
       select 1 from public.admin_accounts account
        where account.id = p_sender_actor_id
          and account.active = true
          and coalesce(account.staff_type, 'admin') in ('admin', 'developer')
     ) then
    raise exception 'invalid_direct_broadcast_attachment_message';
  end if;

  select account.phone, coalesce(account.staff_type, 'admin')
    into v_sender_phone, v_sender_staff_type
    from public.admin_accounts account
   where account.id = p_sender_actor_id
     and account.active = true
     and coalesce(account.staff_type, 'admin') in ('admin', 'developer');
  if not found then
    raise exception 'invalid_direct_broadcast_attachment_message';
  end if;
  v_sender_id := case
    when v_sender_staff_type = 'developer'
      then regexp_replace(v_sender_phone, '[^0-9]', '', 'g')
    else 'admin'
  end;

  select array_agg(value order by value)
    into v_sorted_conversation_ids
    from unnest(p_conversation_ids) value;
  for v_lock_conversation_id in
    select conversation_id
      from unnest(v_sorted_conversation_ids) requested(conversation_id)
     order by conversation_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended(
        'messenger-direct-context:' || v_lock_conversation_id::text,
        0
      )
    );
  end loop;
  if exists (
    select 1
      from unnest(p_conversation_ids) requested(conversation_id)
      left join public.garamin_direct_conversations conversation
        on conversation.id = requested.conversation_id
      left join public.fc_profiles profile
        on profile.id = conversation.fc_id
       and profile.signup_completed = true
       and coalesce(profile.is_manager_referral_shadow, false) = false
       and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
       and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
     where conversation.id is null or profile.id is null
  ) then
    raise exception 'attachment_context_not_found';
  end if;

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
           from unnest(p_message_ids, p_conversation_ids)
             as requested(message_id, conversation_id)
           join public.messages message
             on message.id = requested.message_id
            and message.conversation_id = requested.conversation_id
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
      'attachments', public.materialize_messenger_attachment_batch_v2(v_batch.id, v_count),
      'notifications', v_notifications
    );
  end if;
  if v_batch.status <> 'pending' or v_batch.expires_at <= v_now then
    raise exception 'attachment_intent_expired';
  end if;

  v_attachments := public.materialize_messenger_attachment_batch_v2(v_batch.id, v_count);

  insert into public.messages (
    id,
    conversation_id,
    sender_id,
    receiver_id,
    sender_actor_id,
    receiver_actor_id,
    content,
    message_type,
    is_read,
    attachment_batch_id
  )
  select requested.message_id,
         requested.conversation_id,
         v_sender_id,
         profile.phone,
         p_sender_actor_id,
         profile.id,
         coalesce(p_content, ''),
         'file',
         false,
         v_batch.id
    from unnest(p_message_ids, p_conversation_ids)
      as requested(message_id, conversation_id)
    join public.garamin_direct_conversations conversation
      on conversation.id = requested.conversation_id
    join public.fc_profiles profile
      on profile.id = conversation.fc_id
     and profile.signup_completed = true
     and coalesce(profile.is_manager_referral_shadow, false) = false
     and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
     and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
  on conflict (id) do nothing;

  if (
    select count(*)
      from unnest(p_message_ids, p_conversation_ids)
        as requested(message_id, conversation_id)
      join public.messages message
        on message.id = requested.message_id
       and message.conversation_id = requested.conversation_id
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
    select '새 메시지',
           left(coalesce(nullif(p_content, ''), '첨부파일을 보냈습니다.'), 160),
           'message',
           profile.id,
           profile.phone,
           profile.id,
           'fc',
           jsonb_build_object(
             'version', 1,
             'kind', 'garamin_direct_chat',
             'conversationId', requested.conversation_id
           ),
           '/chat',
           'direct_message:' || requested.message_id::text || ':' || profile.id::text
      from unnest(p_message_ids, p_conversation_ids)
        as requested(message_id, conversation_id)
      join public.garamin_direct_conversations conversation
        on conversation.id = requested.conversation_id
      join public.fc_profiles profile
        on profile.id = conversation.fc_id
       and profile.signup_completed = true
       and coalesce(profile.is_manager_referral_shadow, false) = false
       and coalesce(profile.affiliation, '') not ilike 'request_board_designer:%'
       and replace(coalesce(profile.affiliation, ''), ' ', '') not like '%설계매니저%'
    on conflict (delivery_key) do update
      set delivery_key = excluded.delivery_key
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.id), '[]'::jsonb),
         coalesce(array_agg(inserted.id order by inserted.id), array[]::uuid[])
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

create or replace function public.delete_messenger_attachment_delivery_v2(
  p_message_kind text,
  p_message_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_group_actor_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_batch_id uuid;
  v_deleted_conversation_id uuid;
  v_scheduled integer := 0;
  v_remaining integer := 0;
begin
  if p_message_id is null
     or p_actor_id is null
     or p_actor_role not in ('fc', 'admin', 'manager')
     or p_message_kind not in ('direct', 'group') then
    raise exception 'invalid_attachment_delete_request';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_actor_role || ':' || p_actor_id::text, 0)
  );

  if p_message_kind = 'direct' then
    select message.attachment_batch_id, message.conversation_id
      into v_batch_id, v_deleted_conversation_id
      from public.messages message
     where message.id = p_message_id
       and message.deleted_at is null
       and message.sender_actor_id = p_actor_id
     for update;
  else
    select message.attachment_batch_id
      into v_batch_id
      from public.group_chat_messages message
     where message.id = p_message_id
       and message.deleted_at is null
       and message.sender_actor_id = p_group_actor_id
       and exists (
         select 1
           from public.messenger_attachment_delivery_batches batch
          where batch.id = message.attachment_batch_id
            and batch.actor_id = p_actor_id
            and batch.actor_role = p_actor_role
       )
     for update;
  end if;
  if v_batch_id is null then
    raise exception 'attachment_message_not_found';
  end if;

  perform 1
    from public.messenger_attachment_delivery_batches batch
   where batch.id = v_batch_id
     and batch.actor_id = p_actor_id
     and batch.actor_role = p_actor_role
   for update;
  if not found then
    raise exception 'attachment_message_not_found';
  end if;

  if p_message_kind = 'direct' then
    update public.messages
       set deleted_at = coalesce(deleted_at, v_now),
           deleted_by_actor_id = coalesce(deleted_by_actor_id, p_actor_id),
           content = ''
     where id = p_message_id
       and attachment_batch_id = v_batch_id;
    select count(*)
      into v_remaining
      from public.messages message
     where message.attachment_batch_id = v_batch_id
       and message.deleted_at is null;
  else
    update public.group_chat_messages
       set deleted_at = coalesce(deleted_at, v_now),
           deleted_by_actor_id = coalesce(deleted_by_actor_id, p_group_actor_id),
           content = ''
     where id = p_message_id
       and attachment_batch_id = v_batch_id;
    delete from public.group_chat_notices notice
     where notice.message_id = p_message_id;
    select count(*)
      into v_remaining
      from public.group_chat_messages message
     where message.attachment_batch_id = v_batch_id
       and message.deleted_at is null;
  end if;

  if v_remaining > 0 then
    update public.messenger_attachment_delivery_batches
       set conversation_ids = array_remove(conversation_ids, v_deleted_conversation_id),
           updated_at = v_now
     where id = v_batch_id
       and context_kind = 'direct_broadcast'
       and v_deleted_conversation_id is not null;
    update public.messenger_attachment_objects
       set reference_count = v_remaining
     where batch_id = v_batch_id
       and status = 'active';
    return jsonb_build_object(
      'deleted', true,
      'batchId', v_batch_id,
      'scheduled', 0,
      'retainedForReferences', v_remaining
    );
  end if;

  insert into public.messenger_attachment_deletion_audit (
    original_name,
    byte_size,
    sha256,
    reason_code,
    deleted_at
  )
  select attachment.original_name,
         attachment.byte_size,
         attachment.sha256,
         'message_deleted',
         v_now
    from public.messenger_attachment_objects attachment
   where attachment.batch_id = v_batch_id;

  insert into public.messenger_attachment_cleanup_outbox (
    attachment_id,
    batch_id,
    bucket_id,
    storage_path,
    reason_code,
    sweep_phase,
    not_before
  )
  select attachment.id,
         attachment.batch_id,
         attachment.bucket_id,
         attachment.storage_path,
         'message_deleted',
         phase.sweep_phase,
         case phase.sweep_phase
           when 'immediate' then v_now
           else greatest(batch.expires_at, v_now) + interval '5 minutes'
         end
    from public.messenger_attachment_objects attachment
    join public.messenger_attachment_delivery_batches batch
      on batch.id = attachment.batch_id
    cross join (
      values ('immediate'::text), ('post_token_expiry'::text)
    ) phase(sweep_phase)
   where attachment.batch_id = v_batch_id
     and attachment.storage_path is not null
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
  get diagnostics v_scheduled = row_count;

  update public.messenger_attachment_objects
     set bucket_id = null,
         storage_path = null,
         reference_count = 0,
         status = 'tombstoned',
         tombstoned_at = coalesce(tombstoned_at, v_now)
   where batch_id = v_batch_id;
  update public.messenger_attachment_delivery_batches
     set status = 'deleted',
         deleted_at = coalesce(deleted_at, v_now),
         updated_at = v_now
   where id = v_batch_id;

  return jsonb_build_object(
    'deleted', true,
    'batchId', v_batch_id,
    'scheduled', v_scheduled
  );
end;
$$;

revoke all on function public.delete_messenger_attachment_delivery_v2(
  text, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.delete_messenger_attachment_delivery_v2(
  text, uuid, uuid, text, text
) to service_role;

create or replace function public.expire_messenger_attachment_intents_v2(
  p_limit integer default 50
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_batch_id uuid;
  v_expired integer := 0;
  v_scheduled integer := 0;
  v_rows integer;
begin
  for v_batch_id in
    select batch.id
      from public.messenger_attachment_delivery_batches batch
     where batch.status = 'pending'
       and batch.expires_at <= v_now
     order by batch.expires_at, batch.id
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  loop
    insert into public.messenger_attachment_cleanup_outbox (
      batch_id, bucket_id, storage_path, reason_code, sweep_phase, not_before
    )
    select intent.batch_id,
           intent.bucket_id,
           intent.object_path,
           'expired_intent',
           phase.sweep_phase,
           case phase.sweep_phase
             when 'immediate' then v_now
             else greatest(intent.expires_at, v_now) + interval '5 minutes'
           end
      from public.messenger_attachment_upload_intents intent
      cross join (
        values ('immediate'::text), ('post_token_expiry'::text)
      ) phase(sweep_phase)
     where intent.batch_id = v_batch_id
       and intent.object_path is not null
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
    get diagnostics v_rows = row_count;
    v_scheduled := v_scheduled + v_rows;

    update public.messenger_attachment_upload_intents
       set status = 'expired',
           object_path = null,
           updated_at = v_now
     where batch_id = v_batch_id
       and status in ('pending', 'validated');
    update public.messenger_attachment_delivery_batches
       set status = 'expired',
           updated_at = v_now
     where id = v_batch_id;
    v_expired := v_expired + 1;
  end loop;
  return jsonb_build_object('expired', v_expired, 'scheduled', v_scheduled);
end;
$$;

revoke all on function public.expire_messenger_attachment_intents_v2(integer)
  from public, anon, authenticated;
grant execute on function public.expire_messenger_attachment_intents_v2(integer)
  to service_role;

create or replace function public.claim_messenger_attachment_cleanup_v2(
  p_limit integer default 25,
  p_batch_id uuid default null
)
returns table (
  job_id uuid,
  bucket_id text,
  storage_path text,
  sweep_phase text,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select outbox.id
      from public.messenger_attachment_cleanup_outbox outbox
     where (
       outbox.status = 'pending'
       or (
         outbox.status = 'processing'
         and outbox.locked_at < clock_timestamp() - interval '5 minutes'
       )
     )
       and outbox.not_before <= clock_timestamp()
       and (p_batch_id is null or outbox.batch_id = p_batch_id)
     order by outbox.not_before, outbox.created_at, outbox.id
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  ),
  claimed as (
    update public.messenger_attachment_cleanup_outbox outbox
       set status = 'processing',
           locked_at = clock_timestamp(),
           attempt_count = outbox.attempt_count + 1,
           updated_at = clock_timestamp()
      from candidates
     where outbox.id = candidates.id
    returning outbox.id,
              outbox.bucket_id,
              outbox.storage_path,
              outbox.sweep_phase,
              outbox.attempt_count
  )
  select claimed.id,
         claimed.bucket_id,
         claimed.storage_path,
         claimed.sweep_phase,
         claimed.attempt_count
    from claimed;
end;
$$;

revoke all on function public.claim_messenger_attachment_cleanup_v2(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_messenger_attachment_cleanup_v2(integer, uuid)
  to service_role;

create or replace function public.complete_messenger_attachment_cleanup_v2(
  p_job_id uuid,
  p_removed boolean,
  p_error_code text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_job public.messenger_attachment_cleanup_outbox%rowtype;
  v_next_status text;
begin
  select *
    into v_job
    from public.messenger_attachment_cleanup_outbox outbox
   where outbox.id = p_job_id
   for update;
  if v_job.id is null or v_job.status <> 'processing' then
    raise exception 'attachment_cleanup_job_not_claimed';
  end if;

  if p_removed then
    update public.messenger_attachment_cleanup_outbox
       set status = 'completed',
           bucket_id = null,
           storage_path = null,
           attachment_id = null,
           batch_id = null,
           locked_at = null,
           last_error_code = null,
           completed_at = v_now,
           updated_at = v_now
     where id = v_job.id;
    if v_job.attachment_id is not null
       and not exists (
         select 1
           from public.messenger_attachment_cleanup_outbox pending
          where pending.attachment_id = v_job.attachment_id
            and pending.id <> v_job.id
            and pending.status <> 'completed'
       ) then
      update public.messenger_attachment_objects
         set status = 'deleted',
             deleted_at = coalesce(deleted_at, v_now)
       where id = v_job.attachment_id
         and status = 'tombstoned';
    end if;
    return jsonb_build_object('status', 'completed');
  end if;

  v_next_status := case
    when v_job.attempt_count >= v_job.max_attempts then 'exhausted'
    else 'pending'
  end;
  update public.messenger_attachment_cleanup_outbox
     set status = v_next_status,
         not_before = case
           when v_next_status = 'pending'
             then v_now + make_interval(
               secs => least(3600, (power(2, least(attempt_count, 11))::integer * 5))
             )
           else not_before
         end,
         locked_at = null,
         last_error_code = left(coalesce(nullif(p_error_code, ''), 'storage_remove_failed'), 80),
         updated_at = v_now
   where id = v_job.id;
  return jsonb_build_object('status', v_next_status);
end;
$$;

revoke all on function public.complete_messenger_attachment_cleanup_v2(
  uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.complete_messenger_attachment_cleanup_v2(
  uuid, boolean, text
) to service_role;

create or replace function public.requeue_exhausted_messenger_attachment_cleanup_v2(
  p_limit integer default 25
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with candidates as (
    select outbox.id
      from public.messenger_attachment_cleanup_outbox outbox
     where outbox.status = 'exhausted'
     order by outbox.updated_at, outbox.id
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 25), 100))
  )
  update public.messenger_attachment_cleanup_outbox outbox
     set status = 'pending',
         attempt_count = 0,
         not_before = clock_timestamp(),
         locked_at = null,
         last_error_code = null,
         updated_at = clock_timestamp()
    from candidates
   where outbox.id = candidates.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.requeue_exhausted_messenger_attachment_cleanup_v2(integer)
  from public, anon, authenticated;
grant execute on function public.requeue_exhausted_messenger_attachment_cleanup_v2(integer)
  to service_role;

create or replace function public.queue_messenger_attachment_actor_cleanup_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_actor_role text;
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
    select attachment.original_name,
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
  end loop;
  return old;
end;
$$;

revoke all on function public.queue_messenger_attachment_actor_cleanup_v2()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_queue_fc_messenger_attachment_cleanup
  on public.fc_profiles;
create trigger trg_queue_fc_messenger_attachment_cleanup
  before delete on public.fc_profiles
  for each row execute function public.queue_messenger_attachment_actor_cleanup_v2();

drop trigger if exists trg_queue_manager_messenger_attachment_cleanup
  on public.manager_accounts;
create trigger trg_queue_manager_messenger_attachment_cleanup
  before delete on public.manager_accounts
  for each row execute function public.queue_messenger_attachment_actor_cleanup_v2();

drop trigger if exists trg_queue_admin_messenger_attachment_cleanup
  on public.admin_accounts;
create trigger trg_queue_admin_messenger_attachment_cleanup
  before delete on public.admin_accounts
  for each row execute function public.queue_messenger_attachment_actor_cleanup_v2();

commit;
