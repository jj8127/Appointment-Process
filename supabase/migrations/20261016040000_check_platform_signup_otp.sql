-- 모두온 signup: confirm the SMS code on its own step before the password questions.
-- Same locks, expiry, lock-out and attempt counting as register_platform_member; the
-- challenge is not consumed, so the final signup still verifies the same code.
create or replace function public.check_platform_signup_otp(p_phone text,p_code_hash text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare c platform_signup_challenges; checked_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_phone,741012));
  perform pg_advisory_xact_lock(hashtextextended(p_phone,8102026));
  select * into c from platform_signup_challenges where phone=p_phone for update;
  checked_at:=clock_timestamp();
  if not found or c.expires_at<=checked_at then return jsonb_build_object('ok',false,'code','expired_code'); end if;
  if c.locked_until>checked_at then return jsonb_build_object('ok',false,'code','locked'); end if;
  if c.code_hash is distinct from p_code_hash then
    update platform_signup_challenges set attempts=attempts+1,
      locked_until=case when attempts>=4 then checked_at+interval '10 minutes' else null end where phone=p_phone;
    return jsonb_build_object('ok',false,'code','invalid_code');
  end if;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.check_platform_signup_otp(text,text) from public,anon,authenticated;
grant execute on function public.check_platform_signup_otp(text,text) to service_role;
