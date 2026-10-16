-- DDP-019: owner-reviewed MANUAL SQL only; no application startup migrations.
-- Apply after the corrected shared schema and neon-mad-promotions.sql.
BEGIN;
ALTER TABLE public.mad_promotion_codes
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid='public.mad_promotion_codes'::regclass
      AND conname='mad_deleted_promotion_inactive') THEN
    ALTER TABLE public.mad_promotion_codes ADD CONSTRAINT mad_deleted_promotion_inactive
      CHECK (deleted_at IS NULL OR status='INACTIVE');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.mad_promotion_outbox (
  event_id uuid PRIMARY KEY,
  promo_id uuid NOT NULL REFERENCES public.mad_promotion_codes(promo_id) ON DELETE RESTRICT,
  promotion_version integer NOT NULL CHECK (promotion_version >= 0),
  event_type text NOT NULL CHECK (event_type IN ('promotion.upsert','promotion.deleted')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  UNIQUE (promo_id,promotion_version)
);
CREATE INDEX IF NOT EXISTS mad_promotion_outbox_pending
  ON public.mad_promotion_outbox(created_at,event_id) WHERE published_at IS NULL;
COMMIT;
-- Replace mad_runtime with the actual runtime role before applying these grants:
-- GRANT SELECT,INSERT,UPDATE ON public.mad_promotion_codes TO mad_runtime;
-- GRANT SELECT,INSERT,DELETE ON public.mad_promotion_room_types TO mad_runtime;
-- GRANT SELECT,INSERT ON public.mad_promotion_outbox TO mad_runtime;
-- GRANT SELECT ON public.room_types TO mad_runtime;
-- Outbox publication/acknowledgement permissions belong to the DDP-040 publisher.
