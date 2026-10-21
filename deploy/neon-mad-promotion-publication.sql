-- DDP-040 MANUAL ONLY, after neon-mad-promotion-lifecycle.sql.
-- No source/booking changes; no startup execution. Review grants as schema owner.
BEGIN;
ALTER TABLE public.mad_promotion_outbox
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS mad_promotion_outbox_retry
  ON public.mad_promotion_outbox(next_attempt_at,created_at,event_id)
  WHERE published_at IS NULL;
COMMIT;
-- Replace mad_runtime with the actual restricted publisher role:
-- GRANT SELECT,UPDATE ON public.mad_promotion_outbox TO mad_runtime;
-- No promotion/redemption/booking write grants are needed by the publisher.
