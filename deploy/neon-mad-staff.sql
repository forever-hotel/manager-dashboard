-- Apply manually after the shared schema and neon-mad-auth.sql. Never run at application startup.
BEGIN;
-- Existing case-insensitive duplicate emails must be resolved by the database owner first.
CREATE UNIQUE INDEX IF NOT EXISTS staff_users_email_case_unique ON public.staff_users (lower(email));
CREATE TABLE IF NOT EXISTS public.mad_staff_deliveries (
  delivery_id uuid PRIMARY KEY,
  worker_id uuid NOT NULL UNIQUE REFERENCES public.staff_users(worker_id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','failed','sent','cancelled')),
  encrypted_credentials text,
  credential_version integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  CHECK ((status IN ('pending','failed')) = (encrypted_credentials IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mad_staff_deliveries_due ON public.mad_staff_deliveries(next_attempt_at)
  WHERE status IN ('pending','failed');
REVOKE ALL ON public.mad_staff_deliveries FROM PUBLIC;
COMMIT;
