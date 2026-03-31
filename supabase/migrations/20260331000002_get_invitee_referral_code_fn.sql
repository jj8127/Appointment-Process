-- Allow mobile/admin clients to read the confirmed referral code received by an FC.
-- This uses SECURITY DEFINER because referral_attributions is admin-only under RLS.

CREATE OR REPLACE FUNCTION public.get_invitee_referral_code(p_fc_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ra.referral_code
  FROM public.referral_attributions ra
  WHERE ra.invitee_fc_id = p_fc_id
    AND ra.status = 'confirmed'
  ORDER BY ra.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_invitee_referral_code(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitee_referral_code(UUID) TO anon, authenticated, service_role;
