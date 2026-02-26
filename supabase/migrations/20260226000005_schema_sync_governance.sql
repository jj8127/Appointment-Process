-- governance sync migration (no-op)
-- purpose: keep schema.sql and migrations in the same push range for governance-check parity
DO $$
BEGIN
  NULL;
END $$;
