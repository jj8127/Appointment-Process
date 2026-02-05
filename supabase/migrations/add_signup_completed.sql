-- Add signup_completed field to fc_profiles
-- This field tracks whether the user has completed the full signup process (including password setup)

-- Add column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'fc_profiles'
    AND column_name = 'signup_completed'
  ) THEN
    ALTER TABLE public.fc_profiles
    ADD COLUMN signup_completed boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Migrate existing data: Mark as completed if password is set
UPDATE public.fc_profiles fp
SET signup_completed = true
FROM public.fc_credentials fc
WHERE fp.id = fc.fc_id
  AND fc.password_set_at IS NOT NULL
  AND fp.signup_completed = false;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_fc_profiles_signup_completed
ON public.fc_profiles (signup_completed)
WHERE signup_completed = true;

-- Add comment
COMMENT ON COLUMN public.fc_profiles.signup_completed IS 'True if user has completed full signup process including password setup';
