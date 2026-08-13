create or replace function public.update_board_post_atomic(
  p_post_id uuid,
  p_update_category boolean,
  p_category_id uuid,
  p_update_title boolean,
  p_title text,
  p_update_content boolean,
  p_content text,
  p_attachment_order uuid[]
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_current_attachment_count integer;
  v_requested_attachment_count integer;
  v_distinct_attachment_count integer;
begin
  if not exists (select 1 from public.board_posts where id = p_post_id) then
    raise exception 'board post not found' using errcode = 'P0002';
  end if;

  if p_attachment_order is not null then
    select count(*)::integer
      into v_current_attachment_count
      from public.board_attachments
     where post_id = p_post_id;

    select count(*)::integer, count(distinct requested.attachment_id)::integer
      into v_requested_attachment_count, v_distinct_attachment_count
      from unnest(p_attachment_order) as requested(attachment_id);

    if v_requested_attachment_count <> v_distinct_attachment_count
       or v_requested_attachment_count <> v_current_attachment_count then
      raise exception 'attachment order does not match the post' using errcode = '22023';
    end if;

    if exists (
      select 1
        from unnest(p_attachment_order) as requested(attachment_id)
        left join public.board_attachments attachment
          on attachment.id = requested.attachment_id
         and attachment.post_id = p_post_id
       where attachment.id is null
    ) then
      raise exception 'attachment order contains a foreign attachment' using errcode = '22023';
    end if;

    update public.board_attachments attachment
       set sort_order = (requested.position - 1)::integer
      from unnest(p_attachment_order) with ordinality as requested(attachment_id, position)
     where attachment.id = requested.attachment_id
       and attachment.post_id = p_post_id;
  end if;

  if p_update_category or p_update_title or p_update_content then
    update public.board_posts
       set category_id = case when p_update_category then p_category_id else category_id end,
           title = case when p_update_title then p_title else title end,
           content = case when p_update_content then p_content else content end,
           edited_at = now()
     where id = p_post_id;
  end if;
end;
$$;

revoke all on function public.update_board_post_atomic(uuid, boolean, uuid, boolean, text, boolean, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.update_board_post_atomic(uuid, boolean, uuid, boolean, text, boolean, text, uuid[])
  to service_role;
