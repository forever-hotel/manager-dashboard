-- DDP-021: MANUAL owner-reviewed supplement after the shared schema.
-- Do not run at startup. FOSS retains complaint creation and guest-owned fields.
BEGIN;
CREATE TABLE IF NOT EXISTS public.mad_complaint_state (
  complaint_id uuid PRIMARY KEY REFERENCES public.foss_complaints(complaint_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1)
);
CREATE TABLE IF NOT EXISTS public.mad_complaint_history (
  complaint_id uuid NOT NULL REFERENCES public.foss_complaints(complaint_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  from_status text NOT NULL,
  to_status text NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 4000),
  actor_id uuid NOT NULL REFERENCES public.staff_users(worker_id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY(complaint_id,version),
  CHECK ((from_status='SUBMITTED' AND to_status='UNDER_REVIEW') OR
         (from_status='UNDER_REVIEW' AND to_status='RESOLVED'))
);
CREATE TABLE IF NOT EXISTS public.mad_complaint_outbox (
  event_id uuid PRIMARY KEY,
  complaint_id uuid NOT NULL REFERENCES public.foss_complaints(complaint_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  UNIQUE(complaint_id,version)
);
CREATE INDEX IF NOT EXISTS mad_complaint_outbox_pending
  ON public.mad_complaint_outbox(created_at,event_id) WHERE published_at IS NULL;
REVOKE ALL ON public.mad_complaint_state, public.mad_complaint_history, public.mad_complaint_outbox FROM PUBLIC;
COMMIT;

-- Replace mad_runtime with a dedicated MAD role, then apply as owner:
-- GRANT SELECT(complaint_id,category,description,referenced_worker_id,submitted_at,status,resolved_at)
--   ON public.foss_complaints TO mad_runtime;
-- GRANT UPDATE(status,resolved_at) ON public.foss_complaints TO mad_runtime;
-- GRANT SELECT,INSERT,UPDATE ON public.mad_complaint_state TO mad_runtime;
-- GRANT SELECT,INSERT ON public.mad_complaint_history TO mad_runtime;
-- GRANT INSERT ON public.mad_complaint_outbox TO mad_runtime;
-- FOSS/guest runtime roles must have NO access to the three MAD tables (including
-- through inherited grants). Do not use a shared owner/superuser runtime role.
-- FOSS creates SUBMITTED complaints; MAD is the sole status/resolved_at writer.
-- Existing shared resolution_notes are untouched. Do not copy private notes there.
-- The event publisher uses separate owner-reviewed SELECT/UPDATE grants.
