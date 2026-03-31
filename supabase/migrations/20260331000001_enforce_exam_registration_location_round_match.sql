-- Ensure exam registration locations always belong to the same round.
-- Also repair the known mismatched row before adding the stronger constraint.

DO $$
DECLARE
  target_location_id uuid;
BEGIN
  SELECT el.id
  INTO target_location_id
  FROM public.exam_locations el
  WHERE el.round_id = '19fa6839-c5b5-4959-9222-d9d9623b1f40'
    AND el.location_name = '춘천'
  LIMIT 1;

  IF target_location_id IS NULL THEN
    RAISE EXCEPTION 'Target exam location not found for 4월 4차 생명보험 / 춘천';
  END IF;

  UPDATE public.exam_registrations
  SET location_id = target_location_id
  WHERE id = 'fc0421cd-6016-4732-b28f-324246085bc4'
    AND round_id = '19fa6839-c5b5-4959-9222-d9d9623b1f40';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'exam_locations_id_round_key'
      AND conrelid = 'public.exam_locations'::regclass
  ) THEN
    ALTER TABLE public.exam_locations
      ADD CONSTRAINT exam_locations_id_round_key UNIQUE (id, round_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_exam_registrations_location_round
  ON public.exam_registrations (location_id, round_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'exam_registrations_location_round_fkey'
      AND conrelid = 'public.exam_registrations'::regclass
  ) THEN
    ALTER TABLE public.exam_registrations
      ADD CONSTRAINT exam_registrations_location_round_fkey
      FOREIGN KEY (location_id, round_id)
      REFERENCES public.exam_locations (id, round_id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
DECLARE
  invalid_count integer;
BEGIN
  SELECT COUNT(*)
  INTO invalid_count
  FROM public.exam_registrations er
  JOIN public.exam_locations el
    ON el.id = er.location_id
  WHERE el.round_id <> er.round_id;

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Found % exam_registrations rows with mismatched location round_id', invalid_count;
  END IF;
END $$;
