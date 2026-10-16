-- Messenger stage 1: unified data model.
-- People (actors), organizations, memberships, conversations, participants,
-- messages and events with one per-conversation sequence counter.
-- Legacy messenger tables stay the source of truth until stage 2. These tables
-- are filled by messenger_backfill_v1() and kept in step by dual-write
-- triggers (next migration). All access is service_role only.

create table if not exists public.messenger_actors (
  id uuid primary key default gen_random_uuid(),
  display_name text not null default '',
  phone text check (phone is null or phone ~ '^[0-9]{9,11}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Not unique: a reused phone number must not silently merge two people.
create index if not exists idx_messenger_actors_phone
  on public.messenger_actors (phone) where phone is not null;

create table if not exists public.messenger_actor_links (
  source_kind text not null check (
    source_kind in ('fc', 'admin', 'manager', 'platform_member', 'request_board_user')
  ),
  source_id text not null check (char_length(source_id) between 1 and 64),
  actor_id uuid not null references public.messenger_actors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (source_kind, source_id)
);
create index if not exists idx_messenger_actor_links_actor
  on public.messenger_actor_links (actor_id);

create table if not exists public.messenger_orgs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('garam', 'moduon_ops', 'partner')),
  parent_id uuid references public.messenger_orgs(id) on delete restrict,
  partner_id uuid unique references public.platform_partners(id) on delete restrict,
  slug text unique check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (char_length(trim(name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'partner') = (partner_id is not null)),
  check (parent_id is null or parent_id <> id)
);

create table if not exists public.messenger_org_members (
  org_id uuid not null references public.messenger_orgs(id) on delete cascade,
  actor_id uuid not null references public.messenger_actors(id) on delete cascade,
  role text not null check (
    role in ('fc', 'manager', 'admin', 'developer', 'designer', 'agent', 'org_admin')
  ),
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  approved_by_actor_id uuid references public.messenger_actors(id) on delete set null,
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, actor_id, role),
  check (status <> 'approved' or approved_at is not null),
  check (status <> 'revoked' or revoked_at is not null)
);
create index if not exists idx_messenger_org_members_actor
  on public.messenger_org_members (actor_id) where status = 'approved';

-- Operators allowed to approve partner staff memberships (decision 2026-10-16:
-- start with the owner's own admin account; allowlist so it can grow later).
create table if not exists public.messenger_member_approvers (
  actor_id uuid primary key references public.messenger_actors(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.messenger_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group', 'org_room', 'shared')),
  owner_org_id uuid references public.messenger_orgs(id) on delete restrict,
  subject_actor_id uuid references public.messenger_actors(id) on delete restrict,
  direct_key text unique,
  title text,
  last_event_seq bigint not null default 0 check (last_event_seq >= 0),
  last_message_seq bigint,
  last_message_at timestamptz,
  pinned_notice_seq bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'direct') = (direct_key is not null)),
  check (kind <> 'direct' or (owner_org_id is null and subject_actor_id is null)),
  check (kind <> 'org_room' or (owner_org_id is not null and subject_actor_id is not null)),
  check (kind not in ('group', 'shared') or owner_org_id is not null)
);
-- One room per (organization, customer).
create unique index if not exists idx_messenger_conversations_org_room
  on public.messenger_conversations (owner_org_id, subject_actor_id)
  where kind = 'org_room';

create table if not exists public.messenger_conversation_orgs (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  org_id uuid not null references public.messenger_orgs(id) on delete cascade,
  last_read_seq bigint not null default 0 check (last_read_seq >= 0),
  created_at timestamptz not null default now(),
  primary key (conversation_id, org_id)
);
create index if not exists idx_messenger_conversation_orgs_org
  on public.messenger_conversation_orgs (org_id);

create table if not exists public.messenger_participants (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  actor_id uuid not null references public.messenger_actors(id) on delete cascade,
  -- 'agent' rows only hold an org agent's own read position and preferences;
  -- access to org rooms comes from approved org membership, never from this row.
  role text not null default 'member' check (role in ('member', 'owner', 'subject', 'agent')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  last_read_seq bigint not null default 0 check (last_read_seq >= 0),
  muted boolean not null default false,
  pinned_at timestamptz,
  can_send boolean not null default true,
  blocked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, actor_id)
);
create index if not exists idx_messenger_participants_actor
  on public.messenger_participants (actor_id) where left_at is null;

create table if not exists public.messenger_messages (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  seq bigint not null check (seq > 0),
  id uuid not null unique,
  sender_actor_id uuid references public.messenger_actors(id) on delete set null,
  sender_org_id uuid references public.messenger_orgs(id) on delete set null,
  kind text not null check (kind in ('text', 'image', 'file', 'system')),
  content text not null default '',
  reply_to_seq bigint,
  context jsonb,
  attachment_batch_id uuid,
  legacy_file_url text,
  legacy_file_name text,
  legacy_file_size bigint,
  client_message_id uuid,
  created_at timestamptz not null,
  deleted_at timestamptz,
  deleted_by_actor_id uuid references public.messenger_actors(id) on delete set null,
  primary key (conversation_id, seq),
  check (context is null or jsonb_typeof(context) = 'object')
);
create unique index if not exists idx_messenger_messages_client_id
  on public.messenger_messages (sender_actor_id, client_message_id)
  where client_message_id is not null;
create index if not exists idx_messenger_messages_conversation_created
  on public.messenger_messages (conversation_id, created_at);

create table if not exists public.messenger_events (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  event_seq bigint not null check (event_seq > 0),
  type text not null check (type in ('message', 'delete', 'reaction', 'read', 'notice', 'member')),
  message_seq bigint,
  actor_id uuid references public.messenger_actors(id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (conversation_id, event_seq)
);

create table if not exists public.messenger_reactions (
  conversation_id uuid not null,
  message_seq bigint not null,
  actor_id uuid not null references public.messenger_actors(id) on delete cascade,
  reaction text not null check (char_length(reaction) between 1 and 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, message_seq, actor_id),
  foreign key (conversation_id, message_seq)
    references public.messenger_messages(conversation_id, seq) on delete cascade
);

-- Legacy room -> new conversation. Dual-write triggers only mirror rooms that
-- are mapped here, so a room is never half-filled before its backfill.
create table if not exists public.messenger_legacy_map (
  source_kind text not null check (
    source_kind in ('garamin_direct_thread', 'group_chat_room', 'request_board_pair', 'request_board_direct')
  ),
  source_key text not null,
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (source_kind, source_key)
);
create index if not exists idx_messenger_legacy_map_conversation
  on public.messenger_legacy_map (conversation_id);

-- Rows the backfill or dual-write could not map, for operator review.
create table if not exists public.messenger_sync_issues (
  id bigint generated always as identity primary key,
  source text not null,
  source_key text,
  reason text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.messenger_reconcile_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  result jsonb not null
);

-- Hands out the next sequence number of a conversation. The row lock taken by
-- the update serializes writers of one conversation, so sequences have no gaps
-- or duplicates within a room.
create or replace function public.messenger_next_seq(p_conversation_id uuid)
returns bigint
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_seq bigint;
begin
  update public.messenger_conversations
     set last_event_seq = last_event_seq + 1,
         updated_at = now()
   where id = p_conversation_id
  returning last_event_seq into v_seq;
  if v_seq is null then
    raise exception 'messenger_conversation_not_found';
  end if;
  return v_seq;
end;
$$;

-- Appends one message (idempotent on message id) and its 'message' event.
create or replace function public.messenger_append_message(
  p_conversation_id uuid,
  p_id uuid,
  p_sender_actor_id uuid,
  p_sender_org_id uuid,
  p_kind text,
  p_content text,
  p_created_at timestamptz,
  p_context jsonb default null,
  p_attachment_batch_id uuid default null,
  p_legacy_file_url text default null,
  p_legacy_file_name text default null,
  p_legacy_file_size bigint default null,
  p_client_message_id uuid default null
) returns bigint
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_existing record;
  v_seq bigint;
begin
  select conversation_id, seq into v_existing
    from public.messenger_messages where id = p_id;
  if found then
    if v_existing.conversation_id <> p_conversation_id then
      raise exception 'messenger_message_conversation_conflict';
    end if;
    return v_existing.seq;
  end if;

  v_seq := public.messenger_next_seq(p_conversation_id);
  insert into public.messenger_messages (
    conversation_id, seq, id, sender_actor_id, sender_org_id, kind, content,
    context, attachment_batch_id, legacy_file_url, legacy_file_name,
    legacy_file_size, client_message_id, created_at
  ) values (
    p_conversation_id, v_seq, p_id, p_sender_actor_id, p_sender_org_id, p_kind,
    coalesce(p_content, ''), p_context, p_attachment_batch_id, p_legacy_file_url,
    p_legacy_file_name, p_legacy_file_size, p_client_message_id, p_created_at
  );
  insert into public.messenger_events (conversation_id, event_seq, type, message_seq, actor_id, created_at)
  values (p_conversation_id, v_seq, 'message', v_seq, p_sender_actor_id, p_created_at);
  update public.messenger_conversations
     set last_message_seq = v_seq,
         last_message_at = greatest(coalesce(last_message_at, p_created_at), p_created_at)
   where id = p_conversation_id;
  return v_seq;
end;
$$;

-- Records a non-message change as its own event so clients can sync with one
-- "events after N" cursor.
create or replace function public.messenger_record_event(
  p_conversation_id uuid,
  p_type text,
  p_message_seq bigint,
  p_actor_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns bigint
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_seq bigint;
begin
  v_seq := public.messenger_next_seq(p_conversation_id);
  insert into public.messenger_events (conversation_id, event_seq, type, message_seq, actor_id, payload)
  values (p_conversation_id, v_seq, p_type, p_message_seq, p_actor_id, coalesce(p_payload, '{}'::jsonb));
  return v_seq;
end;
$$;

-- Single place that decides who may read a conversation.
create or replace function public.messenger_can_access(p_actor_id uuid, p_conversation_id uuid)
returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
  select exists (
    select 1
      from public.messenger_participants p
     where p.conversation_id = p_conversation_id
       and p.actor_id = p_actor_id
       and p.role <> 'agent'
       and p.left_at is null
  ) or exists (
    select 1
      from public.messenger_conversation_orgs co
      join public.messenger_org_members m
        on m.org_id = co.org_id and m.actor_id = p_actor_id and m.status = 'approved'
      join public.messenger_orgs o on o.id = co.org_id and o.active
     where co.conversation_id = p_conversation_id
  );
$$;

-- Who may open an org room (decisions 2026-10-16): a customer may always contact
-- an active partner; an approved agent may contact a customer first only when
-- that customer applied for the partner's service, and never after a block.
create or replace function public.messenger_can_start_org_room(
  p_initiator_actor_id uuid,
  p_org_id uuid,
  p_subject_actor_id uuid
) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  v_org public.messenger_orgs%rowtype;
  v_service_key text;
begin
  select * into v_org from public.messenger_orgs where id = p_org_id;
  if not found or not v_org.active then
    return false;
  end if;
  if exists (
    select 1
      from public.messenger_conversations c
      join public.messenger_participants p
        on p.conversation_id = c.id and p.actor_id = p_subject_actor_id
     where c.kind = 'org_room' and c.owner_org_id = p_org_id
       and c.subject_actor_id = p_subject_actor_id and p.blocked_at is not null
  ) then
    return false;
  end if;
  if p_initiator_actor_id = p_subject_actor_id then
    return true;
  end if;
  if not exists (
    select 1 from public.messenger_org_members
     where org_id = p_org_id and actor_id = p_initiator_actor_id and status = 'approved'
  ) then
    return false;
  end if;
  if v_org.kind <> 'partner' then
    return true;
  end if;
  select service_key into v_service_key from public.platform_partners where id = v_org.partner_id;
  return exists (
    select 1
      from public.messenger_actor_links l
      join public.platform_service_applications a
        on a.member_id::text = l.source_id and a.service_key = v_service_key
     where l.actor_id = p_subject_actor_id and l.source_kind = 'platform_member'
  );
end;
$$;

-- Approves or revokes a membership. Only allowlisted operators may decide.
create or replace function public.messenger_decide_org_member(
  p_approver_actor_id uuid,
  p_org_id uuid,
  p_actor_id uuid,
  p_role text,
  p_approve boolean
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_row public.messenger_org_members%rowtype;
begin
  if not exists (select 1 from public.messenger_member_approvers where actor_id = p_approver_actor_id) then
    raise exception 'messenger_approver_forbidden';
  end if;
  update public.messenger_org_members
     set status = case when p_approve then 'approved' else 'revoked' end,
         approved_by_actor_id = case when p_approve then p_approver_actor_id else approved_by_actor_id end,
         approved_at = case when p_approve then now() else approved_at end,
         revoked_at = case when p_approve then null else now() end,
         updated_at = now()
   where org_id = p_org_id and actor_id = p_actor_id and role = p_role
  returning * into v_row;
  if not found then
    raise exception 'messenger_membership_not_found';
  end if;
  return jsonb_build_object('orgId', v_row.org_id, 'actorId', v_row.actor_id, 'role', v_row.role, 'status', v_row.status);
end;
$$;

do $$
declare
  t text;
  f record;
begin
  foreach t in array array[
    'messenger_actors', 'messenger_actor_links', 'messenger_orgs', 'messenger_org_members',
    'messenger_member_approvers', 'messenger_conversations', 'messenger_conversation_orgs',
    'messenger_participants', 'messenger_messages', 'messenger_events', 'messenger_reactions',
    'messenger_legacy_map', 'messenger_sync_issues', 'messenger_reconcile_runs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
  for f in
    select p.oid::regprocedure as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'messenger_next_seq', 'messenger_append_message', 'messenger_record_event',
         'messenger_can_access', 'messenger_can_start_org_room', 'messenger_decide_org_member'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end;
$$;
