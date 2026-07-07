-- Allow confirmed referral attribution to be keyed by FC identity, not recycled phone numbers.
DROP INDEX IF EXISTS public.idx_referral_attributions_one_confirmed_per_phone;
