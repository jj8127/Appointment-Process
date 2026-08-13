create index if not exists idx_messages_live_sender_receiver_created
  on public.messages (sender_id, receiver_id, created_at desc, id desc)
  where deleted_at is null;

create index if not exists idx_messages_live_unread_receiver_sender
  on public.messages (receiver_id, sender_id, created_at desc, id desc)
  where deleted_at is null and is_read = false;

create or replace function public.get_internal_messenger_summaries_v1(
  p_viewer_id text,
  p_target_ids text[]
)
returns table (
  target_id text,
  last_message text,
  last_time timestamptz,
  unread_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with targets as (
    select distinct btrim(raw_target.target_id) as target_id
    from unnest(coalesce(p_target_ids, array[]::text[])) as raw_target(target_id)
    where btrim(raw_target.target_id) <> ''
  )
  select
    target.target_id,
    latest.last_message,
    latest.created_at as last_time,
    coalesce(unread.unread_count, 0)::bigint as unread_count
  from targets as target
  left join lateral (
    select
      coalesce(
        nullif(btrim(message.content), ''),
        nullif(btrim(message.file_name), ''),
        case
          when message.attachment_batch_id is not null then '첨부파일'
          else null
        end
      ) as last_message,
      message.created_at
    from (
      select outbound.*
      from public.messages as outbound
      where outbound.sender_id = p_viewer_id
        and outbound.receiver_id = target.target_id
        and outbound.deleted_at is null

      union all

      select inbound.*
      from public.messages as inbound
      where inbound.sender_id = target.target_id
        and inbound.receiver_id = p_viewer_id
        and inbound.deleted_at is null
    ) as message
    order by message.created_at desc, message.id desc
    limit 1
  ) as latest on true
  left join lateral (
    select count(*)::bigint as unread_count
    from public.messages as unread_message
    where unread_message.receiver_id = p_viewer_id
      and unread_message.sender_id = target.target_id
      and unread_message.is_read = false
      and unread_message.deleted_at is null
  ) as unread on true
  order by target.target_id;
$$;

revoke all on function public.get_internal_messenger_summaries_v1(text, text[])
  from public, anon, authenticated;
grant execute on function public.get_internal_messenger_summaries_v1(text, text[])
  to service_role;
create or replace function public.list_internal_chat_page_v1(
  p_viewer_id text,
  p_include_all_completed_fc boolean,
  p_limit integer,
  p_cursor_latest_at timestamptz default null,
  p_cursor_fc_id uuid default null
)
returns table (
  fc_id uuid,
  name text,
  phone text,
  affiliation text,
  last_message text,
  last_time timestamptz,
  unread_count bigint,
  total_unread bigint,
  latest_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with participants as (
    select
      profile.id as fc_id,
      coalesce(nullif(btrim(profile.name), ''), regexp_replace(profile.phone, '[^0-9]', '', 'g')) as name,
      regexp_replace(profile.phone, '[^0-9]', '', 'g') as phone,
      profile.affiliation
    from public.fc_profiles as profile
    where profile.signup_completed = true
      and char_length(regexp_replace(profile.phone, '[^0-9]', '', 'g')) = 11
      and position('설계매니저' in coalesce(profile.affiliation, '')) = 0
      and (
        p_include_all_completed_fc
        or regexp_replace(coalesce(profile.affiliation, ''), '[[:space:]]+', '', 'g')
          ~ '([0-9]+본부|[0-9]+팀|직할)'
      )
  ), summaries as (
    select
      participant.fc_id,
      participant.name,
      participant.phone,
      participant.affiliation,
      latest.last_message,
      latest.created_at as last_time,
      coalesce(unread.unread_count, 0)::bigint as unread_count,
      coalesce(latest.created_at, 'epoch'::timestamptz) as latest_at
    from participants as participant
    left join lateral (
      select
        coalesce(
          nullif(btrim(message.content), ''),
          nullif(btrim(message.file_name), ''),
          case when message.attachment_batch_id is not null then '첨부파일' else null end
        ) as last_message,
        message.created_at
      from (
        select outbound.*
        from public.messages as outbound
        where outbound.sender_id = p_viewer_id
          and outbound.receiver_id = participant.phone
          and outbound.deleted_at is null
        union all
        select inbound.*
        from public.messages as inbound
        where inbound.sender_id = participant.phone
          and inbound.receiver_id = p_viewer_id
          and inbound.deleted_at is null
      ) as message
      order by message.created_at desc, message.id desc
      limit 1
    ) as latest on true
    left join lateral (
      select pg_catalog.count(*)::bigint as unread_count
      from public.messages as unread_message
      where unread_message.receiver_id = p_viewer_id
        and unread_message.sender_id = participant.phone
        and unread_message.is_read = false
        and unread_message.deleted_at is null
    ) as unread on true
  ), authorized_page as (
    select
      summary.*,
      pg_catalog.sum(summary.unread_count) over ()::bigint as total_unread
    from summaries as summary
  )
  select
    page.fc_id,
    page.name,
    page.phone,
    page.affiliation,
    page.last_message,
    page.last_time,
    page.unread_count,
    page.total_unread,
    page.latest_at
  from authorized_page as page
  where p_cursor_latest_at is null
    or page.latest_at < p_cursor_latest_at
    or (
      page.latest_at = p_cursor_latest_at
      and page.fc_id < p_cursor_fc_id
    )
  order by page.latest_at desc, page.fc_id desc
  limit least(greatest(p_limit, 1), 10000);
$$;

revoke all on function public.list_internal_chat_page_v1(text, boolean, integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.list_internal_chat_page_v1(text, boolean, integer, timestamptz, uuid)
  to service_role;
