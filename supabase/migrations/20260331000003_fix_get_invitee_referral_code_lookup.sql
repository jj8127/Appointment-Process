-- Fix recommender code lookup so admin/mobile screens show the recommender's
-- current active code first, with confirmed attribution code as fallback.

CREATE OR REPLACE FUNCTION public.get_invitee_referral_code(p_fc_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH target_fc AS (
    SELECT fp.id, NULLIF(TRIM(fp.recommender), '') AS recommender_name
    FROM public.fc_profiles fp
    WHERE fp.id = p_fc_id
  )
  SELECT COALESCE(
    (
      SELECT rc.code
      FROM target_fc tf
      JOIN public.fc_profiles inviter
        ON inviter.name = tf.recommender_name
      JOIN public.referral_codes rc
        ON rc.fc_id = inviter.id
       AND rc.is_active = true
      ORDER BY rc.created_at DESC
      LIMIT 1
    ),
    (
      SELECT ra.referral_code
      FROM public.referral_attributions ra
      WHERE ra.invitee_fc_id = p_fc_id
        AND ra.status = 'confirmed'
      ORDER BY ra.created_at DESC
      LIMIT 1
    )
  );
$$;
