-- One-time repair after the 2026-10-14 FC roster restore. Restored completed
-- FC profiles kept their backup credentials while the owner had meanwhile
-- signed up to the common account on the same phone; the restore protected
-- common rows, so the two stayed unlinked and insurance enrollment refuses
-- the phone. Link each pair and keep the member's common password (user
-- decision 2026-10-15) as the single credential, matching enrollment.
set local lock_timeout='3s';
set local statement_timeout='60s';

do $$
declare
  pair record;
  c platform_member_credentials;
begin
  for pair in
    select m.id as member_id, m.phone, f.id as fc_id
    from platform_members m
    join fc_profiles f on f.phone=m.phone and f.signup_completed
      and not coalesce(f.is_manager_referral_shadow,false) and f.account_closed_at is null
    where m.active and m.fc_id is null and m.staff_account_id is null
      and not exists(select from platform_members linked where linked.fc_id=f.id)
    order by m.id
  loop
    -- Same per-phone lock order as signup, enrollment and withdrawal.
    perform pg_advisory_xact_lock(hashtextextended(pair.phone,741012));
    perform pg_advisory_xact_lock(hashtextextended(pair.phone,8102026));
    perform from fc_profiles where id=pair.fc_id for update;
    select * into c from platform_member_credentials where member_id=pair.member_id for update;
    if found then
      insert into fc_credentials(fc_id,password_hash,password_salt,password_set_at)
        values(pair.fc_id,c.password_hash,c.password_salt,c.password_set_at)
      on conflict(fc_id) do update set password_hash=excluded.password_hash,password_salt=excluded.password_salt,
        password_set_at=excluded.password_set_at,failed_count=0,locked_until=null,must_change_password=false,
        temporary_password_issued_at=null,reset_token_hash=null,reset_token_expires_at=null,reset_failed_count=0,
        updated_at=clock_timestamp();
    end if;
    update platform_members m set fc_id=pair.fc_id,
      insurance_consent_version=coalesce(m.insurance_consent_version,'insurance-additional-info-v1'),
      insurance_consent_source=coalesce(m.insurance_consent_source,'company_attested_import'),
      insurance_consent_recorded_at=coalesce(m.insurance_consent_recorded_at,cohort.recorded_at)
    from platform_legacy_membership_cohort cohort
    where m.id=pair.member_id and cohort.account_kind='fc' and cohort.account_id=pair.fc_id;
    -- Restored FCs outside the frozen company cohort link without inventing consent.
    update platform_members set fc_id=pair.fc_id where id=pair.member_id and fc_id is null;
    delete from platform_member_credentials where member_id=pair.member_id;
  end loop;
end $$;
