create or replace function public.get_invitee_referral_code(p_fc_id uuid) returns text
language sql
stable
security definer
set search_path = public
as $$
  with target_fc as (
    select fp.id, fp.recommender_fc_id
    from public.fc_profiles fp
    where fp.id = p_fc_id
  ),
  linked_recommender_code as (
    select rc.code
    from target_fc tf
    join public.referral_codes rc
      on rc.fc_id = tf.recommender_fc_id
     and rc.is_active = true
    order by rc.created_at desc
    limit 1
  ),
  latest_confirmed_attribution as (
    select
      ra.referral_code,
      ra.referral_code_id,
      ra.inviter_fc_id
    from public.referral_attributions ra
    where ra.invitee_fc_id = p_fc_id
      and ra.status = 'confirmed'
    order by coalesce(ra.confirmed_at, ra.created_at) desc, ra.created_at desc
    limit 1
  ),
  confirmed_referral_code_row as (
    select rc.code
    from latest_confirmed_attribution lca
    join public.referral_codes rc
      on rc.id = lca.referral_code_id
    limit 1
  ),
  confirmed_inviter_active_code as (
    select rc.code
    from latest_confirmed_attribution lca
    join public.referral_codes rc
      on rc.fc_id = lca.inviter_fc_id
     and rc.is_active = true
    order by rc.created_at desc
    limit 1
  )
  select coalesce(
    (
      select code
      from confirmed_referral_code_row
    ),
    (
      select referral_code
      from latest_confirmed_attribution
      limit 1
    ),
    (
      select code
      from confirmed_inviter_active_code
      limit 1
    ),
    (
      select code
      from linked_recommender_code
      limit 1
    )
  );
$$;
