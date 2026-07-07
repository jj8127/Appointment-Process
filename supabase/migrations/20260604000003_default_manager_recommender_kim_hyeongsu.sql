-- Ensure every active headquarters manager profile is attached to Kim Hyeongsu
-- as the default recommender in the referral current-state snapshot.

create or replace function public.link_manager_profile_to_default_recommender(
  p_manager_fc_id uuid,
  p_actor_phone text default null,
  p_reason text default 'default_manager_recommender_kim_hyeongsu'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_fc public.fc_profiles%rowtype;
  default_fc public.fc_profiles%rowtype;
  active_code public.referral_codes%rowtype;
  normalized_actor_phone text := nullif(regexp_replace(coalesce(p_actor_phone, ''), '[^0-9]', '', 'g'), '');
  target_phone text;
  target_is_active_manager boolean := false;
  issue_result jsonb;
begin
  if p_manager_fc_id is null then
    raise exception 'manager fc id is required';
  end if;

  select *
    into target_fc
  from public.fc_profiles
  where id = p_manager_fc_id
  for update;

  if not found then
    raise exception 'manager fc profile not found';
  end if;

  target_phone := regexp_replace(coalesce(target_fc.phone, ''), '[^0-9]', '', 'g');

  select exists (
    select 1
    from public.manager_accounts manager_row
    where manager_row.phone = target_phone
      and manager_row.active = true
  )
  into target_is_active_manager;

  if target_is_active_manager is not true and target_fc.is_manager_referral_shadow is not true then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'skipped', 'target_not_active_manager'
    );
  end if;

  select *
    into default_fc
  from public.fc_profiles
  where regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = '01094272550'
    and nullif(trim(coalesce(name, '')), '') = '김형수'
    and (signup_completed = true or is_manager_referral_shadow = true)
    and public.is_request_board_designer_affiliation(affiliation) is not true
  order by signup_completed desc, created_at asc, id asc
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'skipped', 'default_recommender_not_found'
    );
  end if;

  if default_fc.id = target_fc.id then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'skipped', 'self_link_blocked'
    );
  end if;

  select *
    into active_code
  from public.referral_codes
  where fc_id = default_fc.id
    and is_active = true
  order by created_at desc, id desc
  limit 1
  for update;

  if not found then
    begin
      issue_result := public.admin_issue_referral_code(
        default_fc.id,
        coalesce(normalized_actor_phone, '01094272550'),
        'admin',
        'admin',
        'default_manager_recommender_kim_hyeongsu',
        false
      );
    exception when others then
      return jsonb_build_object(
        'ok', true,
        'changed', false,
        'skipped', 'default_recommender_code_unavailable',
        'error', sqlerrm
      );
    end;

    select *
      into active_code
    from public.referral_codes
    where fc_id = default_fc.id
      and is_active = true
    order by created_at desc, id desc
    limit 1
    for update;
  end if;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'skipped', 'default_recommender_code_missing'
    );
  end if;

  begin
    return public.apply_referral_link_state(
      p_invitee_fc_id => target_fc.id,
      p_inviter_fc_id => default_fc.id,
      p_referral_code_id => active_code.id,
      p_referral_code => active_code.code,
      p_source => 'admin_override',
      p_actor_phone => coalesce(normalized_actor_phone, '01094272550'),
      p_actor_role => 'admin',
      p_actor_staff_type => 'admin',
      p_reason => coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'default_manager_recommender_kim_hyeongsu')
    );
  exception when others then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'skipped', 'default_recommender_apply_failed',
      'error', sqlerrm
    );
  end;
end;
$$;

revoke all on function public.link_manager_profile_to_default_recommender(uuid, text, text) from public;
revoke all on function public.link_manager_profile_to_default_recommender(uuid, text, text) from anon;
revoke all on function public.link_manager_profile_to_default_recommender(uuid, text, text) from authenticated;
grant execute on function public.link_manager_profile_to_default_recommender(uuid, text, text) to service_role;

comment on function public.link_manager_profile_to_default_recommender(uuid, text, text)
  is 'Attach an active manager fc_profiles row to 김형수(01094272550) as default recommender. Service-role only; self-link is blocked.';

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

      perform public.link_manager_profile_to_default_recommender(
        existing_profile.id,
        normalized_phone,
        'manager_shadow_refresh'
      );

      return existing_profile.id;
    end if;

    if existing_profile.signup_completed = true
       and not public.is_request_board_designer_affiliation(existing_profile.affiliation) then
      perform public.link_manager_profile_to_default_recommender(
        existing_profile.id,
        normalized_phone,
        'manager_profile_refresh'
      );

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

  perform public.link_manager_profile_to_default_recommender(
    existing_profile.id,
    normalized_phone,
    'manager_shadow_created'
  );

  return existing_profile.id;
end;
$$;

revoke all on function public.ensure_manager_referral_shadow_profile(text, text) from public;
revoke all on function public.ensure_manager_referral_shadow_profile(text, text) from anon;
revoke all on function public.ensure_manager_referral_shadow_profile(text, text) from authenticated;
grant execute on function public.ensure_manager_referral_shadow_profile(text, text) to service_role;

comment on function public.ensure_manager_referral_shadow_profile(text, text)
  is 'Create or refresh the referral-only fc_profiles shadow row for an active manager_accounts identity, then attach it to 김형수 as default recommender. Execute grant is service_role only.';

do $$
declare
  manager_row record;
  profile_row record;
  target_profile_id uuid;
begin
  for manager_row in
    select phone, name
    from public.manager_accounts
    where active = true
      and phone is not null
  loop
    begin
      target_profile_id := public.ensure_manager_referral_shadow_profile(manager_row.phone, manager_row.name);
    exception when others then
      target_profile_id := null;
    end;
  end loop;

  for profile_row in
    select fp.id, fp.phone
    from public.fc_profiles fp
    join public.manager_accounts ma
      on ma.phone = regexp_replace(coalesce(fp.phone, ''), '[^0-9]', '', 'g')
     and ma.active = true
    where public.is_request_board_designer_affiliation(fp.affiliation) is not true
  loop
    perform public.link_manager_profile_to_default_recommender(
      profile_row.id,
      profile_row.phone,
      'manager_profile_backfill'
    );
  end loop;
end;
$$;
