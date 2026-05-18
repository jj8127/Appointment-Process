alter table public.fc_profiles
  add column if not exists is_manager_referral_shadow boolean not null default false;

create or replace function public.resolve_manager_referral_affiliation(
  p_manager_phone text,
  p_manager_name text default null
) returns text
language plpgsql
stable
set search_path = public
as $$
declare
  normalized_phone text := nullif(regexp_replace(coalesce(p_manager_phone, ''), '[^0-9]', '', 'g'), '');
  resolved_affiliation text;
begin
  if normalized_phone is not null then
    select nullif(trim(amm.affiliation), '')
      into resolved_affiliation
    from public.affiliation_manager_mappings amm
    where amm.manager_phone = normalized_phone
      and amm.active = true
    order by amm.created_at asc, amm.affiliation asc
    limit 1;
  end if;

  if resolved_affiliation is not null then
    return resolved_affiliation;
  end if;

  return coalesce(nullif(trim(coalesce(p_manager_name, '')), ''), '본부장');
end;
$$;

create or replace function public.ensure_manager_referral_shadow_profile(
  p_manager_phone text,
  p_manager_name text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_phone text := nullif(regexp_replace(coalesce(p_manager_phone, ''), '[^0-9]', '', 'g'), '');
  manager_row public.manager_accounts%rowtype;
  existing_profile public.fc_profiles%rowtype;
  resolved_name text;
  resolved_affiliation text;
begin
  if normalized_phone is null or normalized_phone !~ '^[0-9]{11}$' then
    raise exception 'manager_phone is required';
  end if;

  select *
    into manager_row
  from public.manager_accounts
  where phone = normalized_phone
    and active = true
  limit 1;

  if not found then
    raise exception 'Active manager account not found';
  end if;

  resolved_name := coalesce(
    nullif(trim(coalesce(p_manager_name, '')), ''),
    nullif(trim(coalesce(manager_row.name, '')), ''),
    '본부장'
  );
  resolved_affiliation := public.resolve_manager_referral_affiliation(normalized_phone, resolved_name);

  select *
    into existing_profile
  from public.fc_profiles
  where phone = normalized_phone
  limit 1
  for update;

  if found then
    if existing_profile.is_manager_referral_shadow = true then
      update public.fc_profiles
      set name = resolved_name,
          affiliation = resolved_affiliation,
          is_manager_referral_shadow = true
      where id = existing_profile.id
      returning *
      into existing_profile;

      return existing_profile.id;
    end if;

    if existing_profile.signup_completed = true
       and not public.is_request_board_designer_affiliation(existing_profile.affiliation) then
      return existing_profile.id;
    end if;

    raise exception 'Manager referral profile conflict';
  end if;

  insert into public.fc_profiles (
    name,
    affiliation,
    phone,
    status,
    signup_completed,
    phone_verified,
    identity_completed,
    is_manager_referral_shadow
  )
  values (
    resolved_name,
    resolved_affiliation,
    normalized_phone,
    'draft',
    false,
    false,
    false,
    true
  )
  returning *
  into existing_profile;

  return existing_profile.id;
end;
$$;

revoke all on function public.ensure_manager_referral_shadow_profile(text, text) from public;
revoke all on function public.ensure_manager_referral_shadow_profile(text, text) from anon;
revoke all on function public.ensure_manager_referral_shadow_profile(text, text) from authenticated;
grant execute on function public.ensure_manager_referral_shadow_profile(text, text) to service_role;

comment on function public.ensure_manager_referral_shadow_profile(text, text)
  is 'Create or refresh the referral-only fc_profiles shadow row for an active manager_accounts identity. Execute grant is service_role only.';

create or replace function public.admin_issue_referral_code(
  p_fc_id uuid,
  p_actor_phone text,
  p_actor_role text,
  p_actor_staff_type text,
  p_reason text default null,
  p_rotate boolean default false
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  target_fc public.fc_profiles%rowtype;
  active_code public.referral_codes%rowtype;
  inserted_code public.referral_codes%rowtype;
  candidate_code text;
  attempts integer := 0;
  event_type text := 'code_generated';
  target_is_active_manager boolean := false;
  actor_role text := nullif(trim(coalesce(p_actor_role, '')), '');
  actor_staff_type text := nullif(trim(coalesce(p_actor_staff_type, '')), '');
  actor_phone text := nullif(regexp_replace(coalesce(p_actor_phone, ''), '[^0-9]', '', 'g'), '');
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_fc_id is null then
    raise exception 'fc_id is required';
  end if;

  select *
    into target_fc
  from public.fc_profiles
  where id = p_fc_id
  for update;

  if not found then
    raise exception 'FC profile not found';
  end if;

  select exists (
    select 1
    from public.manager_accounts ma
    where ma.phone = target_fc.phone
      and ma.active = true
  )
    into target_is_active_manager;

  if target_fc.signup_completed is distinct from true
     and not (target_fc.is_manager_referral_shadow = true and target_is_active_manager) then
    raise exception 'Referral code can only be issued to completed FC profiles or active manager referral profiles';
  end if;

  if coalesce(target_fc.phone, '') !~ '^[0-9]{11}$' then
    raise exception 'Referral code requires normalized 11-digit FC phone';
  end if;

  if exists (
    select 1
    from public.admin_accounts aa
    where aa.phone = target_fc.phone
  ) then
    raise exception 'Admin accounts cannot receive referral codes';
  end if;

  if public.is_request_board_designer_affiliation(target_fc.affiliation) then
    raise exception 'Request-board linked designer profiles cannot receive referral codes';
  end if;

  select *
    into active_code
  from public.referral_codes
  where fc_id = p_fc_id
    and is_active = true
  order by created_at desc
  limit 1
  for update;

  if found and not p_rotate then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'action', 'noop_active_exists',
      'fcId', p_fc_id,
      'previousCodeId', active_code.id,
      'previousCode', active_code.code,
      'codeId', active_code.id,
      'code', active_code.code,
      'eventType', null
    );
  end if;

  if found then
    update public.referral_codes
    set is_active = false,
        disabled_at = now()
    where id = active_code.id;

    event_type := 'code_rotated';
  end if;

  loop
    attempts := attempts + 1;
    if attempts > 10 then
      raise exception 'Failed to generate unique referral code after 10 attempts';
    end if;

    candidate_code := public.generate_referral_code_candidate();

    begin
      insert into public.referral_codes (
        fc_id,
        code,
        is_active,
        disabled_at
      )
      values (
        p_fc_id,
        candidate_code,
        true,
        null
      )
      returning *
      into inserted_code;

      exit;
    exception
      when unique_violation then
        select *
          into active_code
        from public.referral_codes
        where fc_id = p_fc_id
          and is_active = true
        order by created_at desc
        limit 1
        for update;

        if found then
          return jsonb_build_object(
            'ok', true,
            'changed', false,
            'action', 'noop_active_exists',
            'fcId', p_fc_id,
            'previousCodeId', active_code.id,
            'previousCode', active_code.code,
            'codeId', active_code.id,
            'code', active_code.code,
            'eventType', null
          );
        end if;

        candidate_code := null;
    end;
  end loop;

  insert into public.referral_events (
    referral_code_id,
    referral_code,
    inviter_fc_id,
    inviter_phone,
    inviter_name,
    event_type,
    metadata
  )
  values (
    inserted_code.id,
    inserted_code.code,
    target_fc.id,
    target_fc.phone,
    nullif(trim(coalesce(target_fc.name, '')), ''),
    event_type,
    jsonb_strip_nulls(
      jsonb_build_object(
        'actorPhone', actor_phone,
        'actorRole', actor_role,
        'actorStaffType', actor_staff_type,
        'reason', reason,
        'previousCode', active_code.code,
        'previousCodeId', active_code.id,
        'nextCode', inserted_code.code,
        'nextCodeId', inserted_code.id
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'action', case when event_type = 'code_rotated' then 'rotated' else 'generated' end,
    'fcId', p_fc_id,
    'previousCodeId', active_code.id,
    'previousCode', active_code.code,
    'codeId', inserted_code.id,
    'code', inserted_code.code,
    'eventType', event_type
  );
end;
$$;

create or replace function public.admin_backfill_referral_codes(
  p_limit integer default 100,
  p_actor_phone text default null,
  p_actor_role text default null,
  p_actor_staff_type text default null,
  p_reason text default 'initial_backfill'
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  candidate_fc_ids uuid[] := array[]::uuid[];
  candidate_fc_id uuid;
  issue_result jsonb;
  processed integer := 0;
  created integer := 0;
  skipped integer := 0;
  remaining integer := 0;
  normalized_reason text := coalesce(
    nullif(trim(coalesce(p_reason, '')), ''),
    'initial_backfill'
  );
begin
  select coalesce(array_agg(candidate.id), array[]::uuid[])
    into candidate_fc_ids
  from (
    select fp.id
    from public.fc_profiles fp
    where coalesce(fp.phone, '') ~ '^[0-9]{11}$'
      and not public.is_request_board_designer_affiliation(fp.affiliation)
      and not exists (
        select 1
        from public.admin_accounts aa
        where aa.phone = fp.phone
      )
      and (
        fp.signup_completed = true
        or (
          fp.is_manager_referral_shadow = true
          and exists (
            select 1
            from public.manager_accounts ma
            where ma.phone = fp.phone
              and ma.active = true
          )
        )
      )
      and not exists (
        select 1
        from public.referral_codes rc
        where rc.fc_id = fp.id
          and rc.is_active = true
      )
    order by fp.created_at asc, fp.id asc
    limit safe_limit
    for update of fp skip locked
  ) candidate;

  foreach candidate_fc_id in array candidate_fc_ids loop
    processed := processed + 1;

    begin
      issue_result := public.admin_issue_referral_code(
        candidate_fc_id,
        p_actor_phone,
        p_actor_role,
        p_actor_staff_type,
        normalized_reason,
        false
      );

      if coalesce((issue_result ->> 'changed')::boolean, false) then
        created := created + 1;
      else
        skipped := skipped + 1;
      end if;
    exception
      when others then
        skipped := skipped + 1;
    end;
  end loop;

  select count(*)
    into remaining
  from public.fc_profiles fp
  where coalesce(fp.phone, '') ~ '^[0-9]{11}$'
    and not public.is_request_board_designer_affiliation(fp.affiliation)
    and not exists (
      select 1
      from public.admin_accounts aa
      where aa.phone = fp.phone
    )
    and (
      fp.signup_completed = true
      or (
        fp.is_manager_referral_shadow = true
        and exists (
          select 1
          from public.manager_accounts ma
          where ma.phone = fp.phone
            and ma.active = true
        )
      )
    )
    and not exists (
      select 1
      from public.referral_codes rc
      where rc.fc_id = fp.id
        and rc.is_active = true
    );

  return jsonb_build_object(
    'ok', true,
    'processed', processed,
    'created', created,
    'skipped', skipped,
    'remaining', remaining,
    'limit', safe_limit
  );
end;
$$;

do $$
declare
  manager_row record;
begin
  for manager_row in
    select phone, name
    from public.manager_accounts
    where active = true
  loop
    perform public.ensure_manager_referral_shadow_profile(manager_row.phone, manager_row.name);
  end loop;
end;
$$;
