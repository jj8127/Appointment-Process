set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Independent receipt: deleting a comment/post must not make its request reusable.
create table public.board_comment_requests (
  actor_role text not null check (actor_role in ('admin', 'manager', 'fc')),
  actor_id uuid not null, request_id uuid not null, payload_hash text not null,
  response jsonb, created_at timestamptz not null default now(),
  primary key (actor_role, actor_id, request_id)
);
alter table public.board_comment_requests enable row level security;
revoke all on public.board_comment_requests from public, anon, authenticated;
grant select, insert, update on public.board_comment_requests to service_role;
create policy "board_comment_requests service_role" on public.board_comment_requests
  for all to service_role using (true) with check (true);

create or replace function public.create_board_comment_idempotent(
  p_actor_role text, p_actor_phone text, p_actor_name text,
  p_request_id uuid, p_post_id uuid, p_parent_id uuid, p_content text
) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid;
  v_hash text;
  v_receipt public.board_comment_requests%rowtype;
  v_post public.board_posts%rowtype;
  v_parent public.board_comments%rowtype;
  v_root public.board_comments%rowtype;
  v_thread_id uuid;
  v_comment_id uuid;
  v_recipient record;
  v_recipient_id uuid;
  v_notification_id uuid;
  v_notification_ids jsonb := '[]'::jsonb;
  v_notification_stored boolean := true;
  v_response jsonb;
  v_content text := btrim(p_content);
begin
  if p_request_id is null or p_post_id is null or coalesce(v_content, '') = '' then
    raise exception using errcode = '22023', message = 'invalid_payload';
  end if;
  if p_actor_role = 'admin' then
    select id into v_actor_id from public.admin_accounts where phone = p_actor_phone and active;
  elsif p_actor_role = 'manager' then
    select id into v_actor_id from public.manager_accounts where phone = p_actor_phone and active;
  elsif p_actor_role = 'fc' then
    select id into v_actor_id from public.fc_profiles where phone = p_actor_phone and signup_completed;
  end if;
  if v_actor_id is null then raise exception using errcode = '42501', message = 'actor_not_found'; end if;

  v_hash := encode(sha256(convert_to(jsonb_build_array(p_post_id, p_parent_id, v_content)::text, 'UTF8')), 'hex');
  insert into public.board_comment_requests(actor_role, actor_id, request_id, payload_hash)
    values (p_actor_role, v_actor_id, p_request_id, v_hash)
    on conflict (actor_role, actor_id, request_id) do nothing;
  select * into strict v_receipt from public.board_comment_requests
    where actor_role = p_actor_role and actor_id = v_actor_id and request_id = p_request_id for update;
  if v_receipt.payload_hash <> v_hash then return jsonb_build_object('ok', false, 'code', 'request_id_conflict'); end if;
  if v_receipt.response is not null then return v_receipt.response; end if;

  select * into v_post from public.board_posts where id = p_post_id for key share;
  if not found then raise exception using errcode = '22023', message = 'post_not_found'; end if;
  if p_parent_id is not null then
    select * into v_parent from public.board_comments where id = p_parent_id for key share;
    if not found or v_parent.post_id <> p_post_id then raise exception using errcode = '22023', message = 'invalid_parent'; end if;
    if v_parent.parent_id is not null then
      select * into v_root from public.board_comments where id = v_parent.parent_id for key share;
      if not found or v_root.post_id <> p_post_id or v_root.parent_id is not null then
        raise exception using errcode = '22023', message = 'invalid_parent';
      end if;
      v_thread_id := v_root.id;
    else
      v_thread_id := v_parent.id;
    end if;
  end if;

  insert into public.board_comments(post_id, parent_id, content, author_role, author_resident_id, author_name)
    values (p_post_id, p_parent_id, v_content, p_actor_role, p_actor_phone, coalesce(p_actor_name, ''))
    returning id into v_comment_id;

  for v_recipient in
    select distinct recipients.phone, recipients.role from (
      select v_post.author_resident_id as phone, v_post.author_role as role
      union
      select c.author_resident_id, c.author_role from public.board_comments c
        where p_parent_id is not null and c.post_id = p_post_id
          and (c.id = v_thread_id or c.parent_id = v_thread_id or c.id = p_parent_id or c.parent_id = p_parent_id)
    ) recipients where recipients.phone <> p_actor_phone
  loop
    v_recipient_id := null;
    if v_recipient.role = 'admin' then
      select id into v_recipient_id from public.admin_accounts where phone = v_recipient.phone and active;
    elsif v_recipient.role = 'manager' then
      select id into v_recipient_id from public.manager_accounts where phone = v_recipient.phone and active;
    elsif v_recipient.role = 'fc' then
      select id into v_recipient_id from public.fc_profiles where phone = v_recipient.phone and signup_completed;
    end if;
    if v_recipient_id is null then v_notification_stored := false; continue; end if;
    insert into public.notifications(recipient_role, resident_id, recipient_actor_id, title, body,
      category, target, target_url, delivery_key)
    values (v_recipient.role, v_recipient.phone, v_recipient_id, 'New comment', coalesce(v_post.title, 'New comment'),
      case when p_parent_id is null then 'board_comment' else 'board_reply' end,
      jsonb_build_object('version', 1, 'kind', 'board_post', 'postId', p_post_id),
      '/board?postId=' || p_post_id::text,
      'board-comment:' || v_comment_id::text || ':' || v_recipient.role || ':' || v_recipient_id::text)
    returning id into v_notification_id;
    v_notification_ids := v_notification_ids || jsonb_build_array(v_notification_id);
  end loop;

  v_response := jsonb_build_object('ok', true, 'data', jsonb_build_object('id', v_comment_id),
    'notification', jsonb_build_object('notificationStored', v_notification_stored,
      'pushStatus', 'not_attempted', 'retryable', not v_notification_stored, 'notificationIds', v_notification_ids),
    'notificationWarning', case when v_notification_stored then null else 'notification_delivery_incomplete' end);
  update public.board_comment_requests set response = v_response
    where actor_role = p_actor_role and actor_id = v_actor_id and request_id = p_request_id;
  return v_response;
end;
$$;
revoke all on function public.create_board_comment_idempotent(text,text,text,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.create_board_comment_idempotent(text,text,text,uuid,uuid,uuid,text) to service_role;
