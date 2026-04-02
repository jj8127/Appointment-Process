-- Keep invitee referral code lookup on the trusted admin/service path only.

comment on function public.get_invitee_referral_code(uuid)
  is 'Trusted helper for admin-action to read the invitee-facing referral code. Execute grant is service_role only.';

revoke all on function public.get_invitee_referral_code(uuid) from public, anon, authenticated;
grant execute on function public.get_invitee_referral_code(uuid) to service_role;
