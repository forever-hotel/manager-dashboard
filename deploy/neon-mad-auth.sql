-- MANUAL ONLY: minimal login/readiness provisioning after the base schema.
-- Review and apply as the schema owner; this never runs on application startup.
BEGIN;

ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS password_change_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 0 CHECK (session_version >= 0),
  ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

CREATE TABLE IF NOT EXISTS public.mad_revoked_sessions (
  token_hash char(64) PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS mad_revoked_expiry ON public.mad_revoked_sessions(expires_at);
REVOKE ALL ON public.mad_revoked_sessions FROM PUBLIC;

COMMIT;
