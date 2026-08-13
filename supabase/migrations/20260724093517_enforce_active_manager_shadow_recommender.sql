alter function public.apply_referral_link_state(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) rename to _apply_referral_link_state_unchecked_20260724;

revoke all on function public._apply_referral_link_state_unchecked_20260724(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated, service_role;

create or replace function public.apply_referral_link_state(
  p_invitee_fc_id uuid,
  p_inviter_fc_id uuid default null,
  p_referral_code_id uuid default null,
  p_referral_code text default null,
  p_source text default 'self_service',
  p_actor_phone text default null,
  p_actor_role text default null,
  p_actor_staff_type text default null,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inviter_is_manager_shadow boolean := false;
  normalized_inviter_phone text := null;
begin
  if p_inviter_fc_id is not null then
    perform 1
    from public.fc_profiles invitee_fc
    where invitee_fc.id = p_invitee_fc_id
    for update;

    select
      inviter_fc.is_manager_referral_shadow,
      regexp_replace(coalesce(inviter_fc.phone, ''), '[^0-9]', '', 'g')
    into
      inviter_is_manager_shadow,
      normalized_inviter_phone
    from public.fc_profiles inviter_fc
    where inviter_fc.id = p_inviter_fc_id
    for update;

    if inviter_is_manager_shadow is true then
      perform 1
      from public.manager_accounts manager_row
      where regexp_replace(coalesce(manager_row.phone, ''), '[^0-9]', '', 'g') = normalized_inviter_phone
        and manager_row.active = true
      for share;

      if not found then
        raise exception '추천인으로 지정할 수 없는 FC입니다.';
      end if;
    end if;
  end if;

  return public._apply_referral_link_state_unchecked_20260724(
    p_invitee_fc_id => p_invitee_fc_id,
    p_inviter_fc_id => p_inviter_fc_id,
    p_referral_code_id => p_referral_code_id,
    p_referral_code => p_referral_code,
    p_source => p_source,
    p_actor_phone => p_actor_phone,
    p_actor_role => p_actor_role,
    p_actor_staff_type => p_actor_staff_type,
    p_reason => p_reason
  );
end;
$$;

create or replace function public.admin_apply_recommender_override(
  p_invitee_fc_id uuid,
  p_inviter_fc_id uuid default null,
  p_actor_phone text default null,
  p_actor_role text default null,
  p_actor_staff_type text default null,
  p_reason text default null
) returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.apply_referral_link_state(
    p_invitee_fc_id => p_invitee_fc_id,
    p_inviter_fc_id => p_inviter_fc_id,
    p_referral_code_id => null,
    p_referral_code => null,
    p_source => 'admin_override',
    p_actor_phone => p_actor_phone,
    p_actor_role => p_actor_role,
    p_actor_staff_type => p_actor_staff_type,
    p_reason => p_reason
  );
$$;

revoke all on function public.apply_referral_link_state(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
revoke all on function public.admin_apply_recommender_override(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.apply_referral_link_state(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text
) to service_role;
grant execute on function public.admin_apply_recommender_override(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) to service_role;
