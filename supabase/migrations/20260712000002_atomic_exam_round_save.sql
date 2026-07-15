create or replace function public.save_exam_round_atomic(
  p_round_id uuid,
  p_exam_date date,
  p_registration_deadline date,
  p_round_label text,
  p_exam_type text,
  p_notes text,
  p_locations text[]
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_round_id uuid;
  v_location_id uuid;
  v_location_name text;
  v_location_position bigint;
  v_locations text[];
  v_location_count integer;
  v_distinct_location_count integer;
  v_updated_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  if p_registration_deadline is null then
    raise exception 'registration deadline required' using errcode = '22023';
  end if;
  if p_exam_date is not null and p_registration_deadline > p_exam_date then
    raise exception 'registration deadline cannot follow exam date' using errcode = '22023';
  end if;
  if p_round_label is null
     or btrim(p_round_label) = ''
     or char_length(btrim(p_round_label)) > 120 then
    raise exception 'invalid round label' using errcode = '22023';
  end if;
  if p_exam_type not in ('life', 'nonlife') then
    raise exception 'invalid exam type' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 2000 then
    raise exception 'invalid notes' using errcode = '22023';
  end if;

  v_location_count := coalesce(cardinality(p_locations), 0);
  if v_location_count < 1 or v_location_count > 50 then
    raise exception 'invalid location count' using errcode = '22023';
  end if;
  if exists (
    select 1
      from unnest(p_locations) as requested(location_name)
     where requested.location_name is null
        or btrim(requested.location_name) = ''
        or char_length(btrim(requested.location_name)) > 120
  ) then
    raise exception 'invalid location name' using errcode = '22023';
  end if;

  select array_agg(btrim(requested.location_name) order by requested.position),
         count(distinct btrim(requested.location_name))::integer
    into v_locations, v_distinct_location_count
    from unnest(p_locations) with ordinality as requested(location_name, position);

  if v_distinct_location_count <> v_location_count then
    raise exception 'duplicate location name' using errcode = '22023';
  end if;

  if p_round_id is null then
    insert into public.exam_rounds (
      exam_date,
      registration_deadline,
      round_label,
      exam_type,
      notes
    ) values (
      p_exam_date,
      p_registration_deadline,
      btrim(p_round_label),
      p_exam_type,
      p_notes
    )
    returning id into v_round_id;
  else
    update public.exam_rounds
       set exam_date = p_exam_date,
           registration_deadline = p_registration_deadline,
           round_label = btrim(p_round_label),
           exam_type = p_exam_type,
           notes = p_notes
     where id = p_round_id;

    get diagnostics v_updated_count = row_count;
    if v_updated_count <> 1 then
      raise exception 'exam round not found' using errcode = 'P0002';
    end if;
    v_round_id := p_round_id;
  end if;

  for v_location_name, v_location_position in
    select requested.location_name, requested.position
      from unnest(v_locations) with ordinality as requested(location_name, position)
  loop
    v_location_id := null;
    select location.id
      into v_location_id
      from public.exam_locations location
     where location.round_id = v_round_id
       and location.location_name = v_location_name
     order by location.created_at, location.id
     limit 1
     for update;

    if v_location_id is null then
      insert into public.exam_locations (round_id, location_name, sort_order)
      values (v_round_id, v_location_name, (v_location_position - 1)::integer);
    else
      update public.exam_locations
         set sort_order = (v_location_position - 1)::integer
       where id = v_location_id;
    end if;
  end loop;

  -- Preserve a removed location while an existing registration still references it.
  -- Every other stale location is deleted within this same transaction.
  delete from public.exam_locations location
   where location.round_id = v_round_id
     and not (btrim(location.location_name) = any(v_locations))
     and not exists (
       select 1
         from public.exam_registrations registration
        where registration.location_id = location.id
     );

  return v_round_id;
end;
$$;

revoke all on function public.save_exam_round_atomic(uuid, date, date, text, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.save_exam_round_atomic(uuid, date, date, text, text, text, text[])
  to service_role;
