-- Current canonical Edge source closures use the FC completion-capability
-- lifecycle. Preserve applied history and data columns while retiring the
-- unused parallel proof protocol. RESTRICT preserves unexpected dependents.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $$
begin
  if exists (
    select 1 from public.fc_profiles
    where phone_verification_challenge_id is not null
      or signup_verification_proof_hash is not null
  ) then
    raise exception 'legacy_fc_signup_state_not_empty';
  end if;
end;
$$;

drop function if exists public.issue_signup_otp_challenge_v1(uuid, text, uuid, text) restrict;
drop function if exists public.process_signup_otp_challenge_v1(text, uuid, text, text, boolean) restrict;
drop function if exists public.validate_signup_verification_proof_v1(text, text) restrict;
drop function if exists public.complete_fc_signup_atomic_v1(
  uuid, text, text, text, text, text, text, text, text, text[], uuid, uuid, text
) restrict;
