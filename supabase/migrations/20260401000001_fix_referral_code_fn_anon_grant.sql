-- Restrict get_invitee_referral_code to service_role only.
REVOKE EXECUTE ON FUNCTION public.get_invitee_referral_code(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_invitee_referral_code(UUID) TO service_role;
