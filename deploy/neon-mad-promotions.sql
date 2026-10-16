-- DDP-018: manual DBA execution only. Never invoked by the application or Compose.
-- Requires the corrected shared schema's mad_promotion_codes,
-- mad_promotion_room_types and room_types tables. This does not rewrite existing data.
BEGIN;
-- Fails and rolls back if legacy normalized duplicates exist. Review them manually;
-- do not silently merge promotions or alter their redemption history.
CREATE UNIQUE INDEX IF NOT EXISTS mad_promotion_code_normalized_unique
  ON public.mad_promotion_codes (upper(btrim(code_string)));
COMMIT;

-- DBA: grant the actual runtime role (substitute its name before execution):
-- GRANT SELECT, INSERT ON public.mad_promotion_codes, public.mad_promotion_room_types TO mad_runtime;
-- GRANT SELECT ON public.room_types TO mad_runtime;
