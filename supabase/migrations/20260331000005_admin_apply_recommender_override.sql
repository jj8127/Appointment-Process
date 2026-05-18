create or replace function public.admin_apply_recommender_override(
  p_invitee_fc_id uuid,
  p_inviter_fc_id uuid default null,
  p_actor_phone text default null,
  p_actor_role text default null,
  p_actor_staff_type text default null,
  p_reason text default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  invitee_fc public.fc_profiles%rowtype;
  inviter_fc public.fc_profiles%rowtype;
  inviter_active_code public.referral_codes%rowtype;
  primary_confirmed public.referral_attributions%rowtype;
  confirmed_ids uuid[] := array[]::uuid[];
  secondary_confirmed_ids uuid[] := array[]::uuid[];
  actor_role text := nullif(trim(coalesce(p_actor_role, '')), '');
  actor_staff_type text := nullif(trim(coalesce(p_actor_staff_type, '')), '');
  actor_phone text := nullif(regexp_replace(coalesce(p_actor_phone, ''), '[^0-9]', '', 'g'), '');
  reason text := nullif(trim(coalesce(p_reason, '')), '');
  normalized_invitee_phone text;
  normalized_inviter_phone text := null;
  next_recommender_name text := null;
  attribution_id uuid := null;
  changed boolean := false;
  now_ts timestamptz := now();
begin
  if p_invitee_fc_id is null then
    raise exception '추천인 대상 FC를 찾을 수 없습니다.';
  end if;
  if reason is null then
    raise exception '추천인 변경 사유를 입력해주세요.';
  end if;
  if p_inviter_fc_id is not null and p_inviter_fc_id = p_invitee_fc_id then
    raise exception '자기 자신을 추천인으로 지정할 수 없습니다.';
  end if;

  select *
    into invitee_fc
  from public.fc_profiles
  where id = p_invitee_fc_id
  for update;

  if not found then
    raise exception '추천인 대상 FC를 찾을 수 없습니다.';
  end if;

  normalized_invitee_phone := regexp_replace(coalesce(invitee_fc.phone, ''), '[^0-9]', '', 'g');
  if normalized_invitee_phone !~ '^[0-9]{11}$' then
    raise exception '추천 관계 대상 FC 전화번호가 올바르지 않습니다.';
  end if;

  if p_inviter_fc_id is not null then
    select *
      into inviter_fc
    from public.fc_profiles
    where id = p_inviter_fc_id
    for update;

    if not found then
      raise exception '추천인 후보 FC를 찾을 수 없습니다.';
    end if;

    normalized_inviter_phone := regexp_replace(coalesce(inviter_fc.phone, ''), '[^0-9]', '', 'g');
    if normalized_inviter_phone !~ '^[0-9]{11}$' then
      raise exception '추천인 후보 FC 전화번호가 올바르지 않습니다.';
    end if;

    select *
      into inviter_active_code
    from public.referral_codes
    where fc_id = p_inviter_fc_id
      and is_active = true
    order by created_at desc
    limit 1
    for update;

    if not found then
      raise exception '활성 추천코드가 있는 FC만 추천인으로 선택할 수 있습니다.';
    end if;

    next_recommender_name := nullif(trim(coalesce(inviter_fc.name, '')), '');
  end if;

  select coalesce(array_agg(ra.id order by coalesce(ra.confirmed_at, ra.created_at) desc, ra.created_at desc), array[]::uuid[])
    into confirmed_ids
  from public.referral_attributions ra
  where ra.invitee_fc_id = p_invitee_fc_id
    and ra.status = 'confirmed';

  if coalesce(array_length(confirmed_ids, 1), 0) > 0 then
    select *
      into primary_confirmed
    from public.referral_attributions
    where id = confirmed_ids[1]
    for update;

    if coalesce(array_length(confirmed_ids, 1), 0) > 1 then
      secondary_confirmed_ids := confirmed_ids[2:array_length(confirmed_ids, 1)];
    end if;
  end if;

  changed :=
    invitee_fc.recommender_fc_id is distinct from p_inviter_fc_id
    or nullif(trim(coalesce(invitee_fc.recommender, '')), '') is distinct from next_recommender_name
    or (
      p_inviter_fc_id is not null
      and (
        primary_confirmed.id is null
        or primary_confirmed.inviter_fc_id is distinct from p_inviter_fc_id
        or primary_confirmed.referral_code_id is distinct from inviter_active_code.id
      )
    )
    or (
      p_inviter_fc_id is null
      and coalesce(array_length(confirmed_ids, 1), 0) > 0
    );

  if not changed then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'inviteeFcId', p_invitee_fc_id,
      'inviterFcId', p_inviter_fc_id,
      'recommenderName', next_recommender_name,
      'referralCode', case when p_inviter_fc_id is not null then inviter_active_code.code else null end
    );
  end if;

  if p_inviter_fc_id is not null then
    if primary_confirmed.id is not null then
      update public.referral_attributions
      set inviter_fc_id = p_inviter_fc_id,
          inviter_phone = normalized_inviter_phone,
          inviter_name = inviter_fc.name,
          invitee_fc_id = p_invitee_fc_id,
          invitee_phone = normalized_invitee_phone,
          referral_code_id = inviter_active_code.id,
          referral_code = inviter_active_code.code,
          source = 'admin_override',
          capture_source = 'manual_entry',
          selection_source = 'admin_override',
          status = 'confirmed',
          cancelled_at = null,
          confirmed_at = now_ts
      where id = primary_confirmed.id
      returning id into attribution_id;
    else
      insert into public.referral_attributions (
        inviter_fc_id,
        inviter_phone,
        inviter_name,
        invitee_fc_id,
        invitee_phone,
        referral_code_id,
        referral_code,
        source,
        capture_source,
        selection_source,
        status,
        captured_at,
        confirmed_at
      )
      values (
        p_inviter_fc_id,
        normalized_inviter_phone,
        inviter_fc.name,
        p_invitee_fc_id,
        normalized_invitee_phone,
        inviter_active_code.id,
        inviter_active_code.code,
        'admin_override',
        'manual_entry',
        'admin_override',
        'confirmed',
        now_ts,
        now_ts
      )
      returning id into attribution_id;
    end if;

    if coalesce(array_length(secondary_confirmed_ids, 1), 0) > 0 then
      update public.referral_attributions
      set status = 'overridden',
          source = 'admin_override',
          selection_source = 'admin_override',
          cancelled_at = now_ts
      where id = any(secondary_confirmed_ids);
    end if;
  elsif coalesce(array_length(confirmed_ids, 1), 0) > 0 then
    update public.referral_attributions
    set status = 'overridden',
        source = 'admin_override',
        selection_source = 'admin_override',
        cancelled_at = now_ts
    where id = any(confirmed_ids);
  end if;

  update public.fc_profiles
  set recommender_fc_id = p_inviter_fc_id,
      recommender = next_recommender_name
  where id = p_invitee_fc_id;

  insert into public.referral_events (
    attribution_id,
    referral_code_id,
    referral_code,
    inviter_fc_id,
    inviter_phone,
    inviter_name,
    invitee_fc_id,
    invitee_phone,
    event_type,
    source,
    metadata
  )
  values (
    attribution_id,
    case when p_inviter_fc_id is not null then inviter_active_code.id else null end,
    case when p_inviter_fc_id is not null then inviter_active_code.code else null end,
    p_inviter_fc_id,
    normalized_inviter_phone,
    case when p_inviter_fc_id is not null then inviter_fc.name else null end,
    p_invitee_fc_id,
    normalized_invitee_phone,
    'admin_override_applied',
    'admin_override',
    jsonb_strip_nulls(
      jsonb_build_object(
        'actorPhone', actor_phone,
        'actorRole', actor_role,
        'actorStaffType', actor_staff_type,
        'reason', reason,
        'beforeRecommenderName', nullif(trim(coalesce(invitee_fc.recommender, '')), ''),
        'beforeRecommenderFcId', invitee_fc.recommender_fc_id,
        'beforeConfirmedAttributionIds', to_jsonb(confirmed_ids),
        'afterRecommenderName', next_recommender_name,
        'afterRecommenderFcId', p_inviter_fc_id,
        'afterReferralCode', case when p_inviter_fc_id is not null then inviter_active_code.code else null end,
        'cleared', p_inviter_fc_id is null
      )
    )
  );

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'inviteeFcId', p_invitee_fc_id,
    'inviterFcId', p_inviter_fc_id,
    'recommenderName', next_recommender_name,
    'referralCode', case when p_inviter_fc_id is not null then inviter_active_code.code else null end
  );
end;
$$;

revoke all on function public.admin_apply_recommender_override(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_apply_recommender_override(uuid, uuid, text, text, text, text) to service_role;
