-- Canonicalize the 7th headquarters manager label from 김동훈 to 이동훈.
-- Keep legacy labels as accepted inputs in application code, but store current data as 7본부 이동훈.

do $$
declare
  old_label constant text := '7본부 김동훈';
  new_label constant text := '7본부 이동훈';
  legacy_labels constant text[] := array[
    '7본부 김동훈',
    '7본부 [본부장: 김동훈]',
    '7본부 [본부장: 이동훈]',
    '7팀(청주1/직할) : 김동훈 본부장님',
    '7팀(청주1/직할) : 이동훈 본부장님'
  ];
begin
  update public.affiliation_manager_mappings
  set affiliation = new_label,
      updated_at = now()
  where affiliation = any(legacy_labels)
    and affiliation is distinct from new_label;

  update public.manager_accounts ma
  set name = '이동훈',
      updated_at = now()
  where ma.name = '김동훈'
    and exists (
      select 1
      from public.affiliation_manager_mappings amm
      where regexp_replace(amm.manager_phone, '[^0-9]', '', 'g') = regexp_replace(ma.phone, '[^0-9]', '', 'g')
        and amm.affiliation = new_label
        and amm.active = true
    );

  update public.fc_profiles
  set affiliation = new_label,
      updated_at = now()
  where affiliation = any(legacy_labels)
    and affiliation is distinct from new_label;

  update public.fc_profiles fp
  set name = '이동훈',
      updated_at = now()
  where fp.is_manager_referral_shadow = true
    and fp.name = '김동훈'
    and exists (
      select 1
      from public.manager_accounts ma
      where regexp_replace(ma.phone, '[^0-9]', '', 'g') = regexp_replace(fp.phone, '[^0-9]', '', 'g')
        and ma.name = '이동훈'
        and ma.active = true
    );

  update public.fc_profiles invitee
  set recommender = '이동훈',
      updated_at = now()
  where invitee.recommender = '김동훈'
    and invitee.recommender_fc_id in (
      select id
      from public.fc_profiles
      where is_manager_referral_shadow = true
        and name = '이동훈'
        and affiliation = new_label
    );

  update public.referral_events re
  set inviter_name = '이동훈'
  where re.inviter_name = '김동훈'
    and re.inviter_fc_id in (
      select id
      from public.fc_profiles
      where is_manager_referral_shadow = true
        and name = '이동훈'
        and affiliation = new_label
    );

  update public.referral_attributions ra
  set inviter_name = '이동훈'
  where ra.inviter_name = '김동훈'
    and ra.inviter_fc_id in (
      select id
      from public.fc_profiles
      where is_manager_referral_shadow = true
        and name = '이동훈'
        and affiliation = new_label
    );

  update public.device_tokens dt
  set display_name = '이동훈',
      updated_at = now()
  where dt.display_name = '김동훈'
    and exists (
      select 1
      from public.manager_accounts ma
      where regexp_replace(ma.phone, '[^0-9]', '', 'g') = regexp_replace(dt.resident_id, '[^0-9]', '', 'g')
        and ma.name = '이동훈'
        and ma.active = true
    );
end $$;