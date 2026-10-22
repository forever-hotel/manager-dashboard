-- Disposable integration-test SQL only; never apply this fixture to Neon.
-- Manual complete schema: docs/forever-hotel.sql (local and Git-ignored).

-- BEGIN MAD SECTION: auth
-- MANUAL ONLY: minimal login/readiness provisioning after the base schema.
-- Review and apply as the schema owner; this never runs on application startup.

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
-- END MAD SECTION: auth

-- BEGIN MAD SECTION: complaints
-- DDP-021: MANUAL owner-reviewed supplement after the shared schema.
-- Do not run at startup. FOSS retains complaint creation and guest-owned fields.

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
-- END MAD SECTION: complaints

-- BEGIN MAD SECTION: notifications
-- DDP-043. Review and apply manually after auth and complaint supplements.
-- Never executed by application startup. Does not modify source issues.

CREATE TABLE IF NOT EXISTS public.mad_notification_reads (
 manager_id uuid NOT NULL REFERENCES public.staff_users(worker_id),
 type text NOT NULL CHECK(type IN ('COMPLAINT','STOCK')),
 entity_id uuid NOT NULL,
 revision varchar(100) NOT NULL CHECK(revision ~ '^[A-Z0-9:_-]{1,100}$'),
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(manager_id,type,entity_id)
);
REVOKE ALL ON public.mad_notification_reads FROM PUBLIC;

-- Replace mad_runtime with the reviewed dedicated MAD runtime role:
-- GRANT SELECT,INSERT,UPDATE ON public.mad_notification_reads TO mad_runtime;
-- GRANT SELECT(complaint_id,category,status,submitted_at) ON public.foss_complaints TO mad_runtime;
-- GRANT SELECT(complaint_id,version) ON public.mad_complaint_state TO mad_runtime;
-- GRANT SELECT(menu_item_id,name,stock_status,updated_at) ON public.kms_menu_items TO mad_runtime;
-- No source INSERT/UPDATE/DELETE privileges are required for notifications.
-- END MAD SECTION: notifications

-- BEGIN MAD SECTION: promotion-lifecycle
-- DDP-019: owner-reviewed MANUAL SQL only; no application startup migrations.
-- Apply after the corrected shared schema and the promotions section.

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

-- Replace mad_runtime with the actual runtime role before applying these grants:
-- GRANT SELECT,INSERT,UPDATE ON public.mad_promotion_codes TO mad_runtime;
-- GRANT SELECT,INSERT,DELETE ON public.mad_promotion_room_types TO mad_runtime;
-- GRANT SELECT,INSERT ON public.mad_promotion_outbox TO mad_runtime;
-- GRANT SELECT ON public.room_types TO mad_runtime;
-- Outbox publication/acknowledgement permissions belong to the DDP-040 publisher.
-- END MAD SECTION: promotion-lifecycle

-- BEGIN MAD SECTION: promotion-publication
-- DDP-040 MANUAL ONLY, after the promotion-lifecycle section.
-- No source/booking changes; no startup execution. Review grants as schema owner.

ALTER TABLE public.mad_promotion_outbox
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS mad_promotion_outbox_retry
  ON public.mad_promotion_outbox(next_attempt_at,created_at,event_id)
  WHERE published_at IS NULL;

-- Replace mad_runtime with the actual restricted publisher role:
-- GRANT SELECT,UPDATE ON public.mad_promotion_outbox TO mad_runtime;
-- No promotion/redemption/booking write grants are needed by the publisher.
-- END MAD SECTION: promotion-publication

-- BEGIN MAD SECTION: promotions
-- DDP-018: manual DBA execution only. Never invoked by the application or Compose.
-- Requires the corrected shared schema's mad_promotion_codes,
-- mad_promotion_room_types and room_types tables. This does not rewrite existing data.

-- Fails and rolls back if legacy normalized duplicates exist. Review them manually;
-- do not silently merge promotions or alter their redemption history.
CREATE UNIQUE INDEX IF NOT EXISTS mad_promotion_code_normalized_unique
  ON public.mad_promotion_codes (upper(btrim(code_string)));

-- DBA: grant the actual runtime role (substitute its name before execution):
-- GRANT SELECT, INSERT ON public.mad_promotion_codes, public.mad_promotion_room_types TO mad_runtime;
-- GRANT SELECT ON public.room_types TO mad_runtime;
-- END MAD SECTION: promotions

-- BEGIN MAD SECTION: realtime
-- DDP-039: manually apply after owner review. Never run at application startup.

CREATE TABLE IF NOT EXISTS mad_realtime_versions (
  order_id uuid PRIMARY KEY,
  version bigint NOT NULL CHECK (version >= 0)
);
CREATE TABLE IF NOT EXISTS mad_realtime_events (
  event_id uuid PRIMARY KEY,
  order_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version >= 0),
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS mad_realtime_pending_idx
  ON mad_realtime_events(received_at,event_id) WHERE delivered_at IS NULL;

-- Substitute your restricted MAD role; do not grant these to guest/FOSS/KMS roles.
-- GRANT SELECT,INSERT,UPDATE ON mad_realtime_events,mad_realtime_versions TO mad_runtime;
-- GRANT SELECT(order_id,room_number,meal_period,status,placed_at,updated_at,delivered_at)
--   ON kms_food_orders TO mad_runtime;
-- GRANT SELECT(order_id,quantity) ON kms_food_order_items TO mad_runtime;
-- END MAD SECTION: realtime

-- BEGIN MAD SECTION: rooms
-- DDP-027: manual MAD-only supplement. Do not execute at application startup.

CREATE TABLE IF NOT EXISTS mad_room_versions (
 room_id varchar(10) PRIMARY KEY, version bigint NOT NULL CHECK(version>=0)
);
CREATE TABLE IF NOT EXISTS mad_room_events (
 event_id uuid PRIMARY KEY, room_id varchar(10) NOT NULL,
 version bigint NOT NULL CHECK(version>=0), payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS mad_room_events_pending_idx ON mad_room_events(received_at,event_id) WHERE delivered_at IS NULL;

-- Replace mad_runtime with your restricted runtime role after review:
-- GRANT SELECT(room_number,room_type_id,floor,status,updated_at) ON rooms TO mad_runtime;
-- GRANT SELECT(room_type_id,type_name) ON room_types TO mad_runtime;
-- GRANT SELECT,INSERT,UPDATE ON mad_room_events,mad_room_versions TO mad_runtime;
-- END MAD SECTION: rooms

-- BEGIN MAD SECTION: staff
-- Apply manually after the shared schema and the auth section. Never run at application startup.

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
-- END MAD SECTION: staff

-- BEGIN MAD SECTION: stock
-- DDP-034: review and apply manually after the shared KMS schema. Never run at startup.

CREATE TABLE IF NOT EXISTS public.mad_stock_alerts (
 alert_id uuid PRIMARY KEY, menu_item_id uuid NOT NULL UNIQUE,
 item_name varchar(255) NOT NULL, stock_status text NOT NULL CHECK(stock_status IN ('AVAILABLE','LOW_STOCK','UNAVAILABLE','TEMPORARILY_DISABLED')),
 active boolean NOT NULL,version bigint NOT NULL CHECK(version BETWEEN 0 AND 9007199254740991),
 source_updated_at timestamptz NOT NULL,raised_at timestamptz,cleared_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(active=(stock_status<>'AVAILABLE')),
 CHECK(NOT active OR (raised_at IS NOT NULL AND cleared_at IS NULL))
);
CREATE INDEX IF NOT EXISTS mad_stock_alerts_active_idx ON public.mad_stock_alerts(updated_at,menu_item_id) WHERE active;
CREATE TABLE IF NOT EXISTS public.mad_stock_events (
 event_id uuid PRIMARY KEY,menu_item_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version BETWEEN 0 AND 9007199254740991),
 received_payload jsonb NOT NULL,payload jsonb,
 delivery_state text NOT NULL CHECK(delivery_state IN ('pending','published','superseded')),
 received_at timestamptz NOT NULL DEFAULT now(),published_at timestamptz,
 CHECK(payload IS NOT NULL OR delivery_state='superseded')
);
CREATE INDEX IF NOT EXISTS mad_stock_events_pending_idx ON public.mad_stock_events(received_at,event_id) WHERE delivery_state='pending';
REVOKE ALL ON public.mad_stock_alerts,public.mad_stock_events FROM PUBLIC;

-- Replace mad_runtime with your restricted MAD runtime role after review:
-- GRANT SELECT(menu_item_id,name,stock_status,updated_at) ON public.kms_menu_items TO mad_runtime;
-- GRANT SELECT,INSERT,UPDATE ON public.mad_stock_alerts,public.mad_stock_events TO mad_runtime;
-- No KMS source-table INSERT/UPDATE/DELETE grants are required.
-- END MAD SECTION: stock

-- BEGIN MAD SECTION: task-limit
-- DDP-045: review/apply manually after the shared staff/auth schema.
-- No task rows are changed. Never run at application startup.

CREATE TABLE IF NOT EXISTS public.mad_task_limit_history (
 version integer PRIMARY KEY CHECK(version>=0),
 task_limit smallint NOT NULL CHECK(task_limit BETWEEN 1 AND 10),
 changed_by uuid REFERENCES public.staff_users(worker_id),
 changed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(version,task_limit)
);
INSERT INTO public.mad_task_limit_history(version,task_limit) VALUES(0,3) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.mad_task_limit_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 requested_limit smallint NOT NULL CHECK(requested_limit BETWEEN 1 AND 10),
 version integer NOT NULL CHECK(version>=0),
 updated_by uuid REFERENCES public.staff_users(worker_id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(version,requested_limit) REFERENCES public.mad_task_limit_history(version,task_limit) DEFERRABLE INITIALLY DEFERRED
);
INSERT INTO public.mad_task_limit_policy(singleton,requested_limit,version) VALUES(true,3,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.mad_task_limit_ack (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 version integer NOT NULL CHECK(version>=0),
 task_limit smallint NOT NULL CHECK(task_limit BETWEEN 1 AND 10),
 applied_at timestamptz NOT NULL DEFAULT now(),
 confirmed_by name NOT NULL,
 FOREIGN KEY(version,task_limit) REFERENCES public.mad_task_limit_history(version,task_limit)
);
-- WKMS calls this in the SAME transaction as activating its claim-enforced policy.
-- It must lock mad_task_limit_policy first and use the same lock order for claims.
CREATE OR REPLACE FUNCTION public.mad_confirm_task_limit(expected_version integer, applied_limit integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy public.mad_task_limit_policy%ROWTYPE;
BEGIN
 SELECT * INTO policy FROM public.mad_task_limit_policy WHERE singleton FOR UPDATE;
 IF NOT FOUND OR expected_version IS DISTINCT FROM policy.version OR applied_limit IS DISTINCT FROM policy.requested_limit THEN
  RAISE EXCEPTION 'TASK_LIMIT_POLICY_CHANGED' USING ERRCODE='40001';
 END IF;
 INSERT INTO public.mad_task_limit_ack AS ack(singleton,version,task_limit,applied_at,confirmed_by)
 VALUES(true,expected_version,applied_limit,clock_timestamp(),session_user)
 ON CONFLICT(singleton) DO UPDATE SET version=EXCLUDED.version,task_limit=EXCLUDED.task_limit,
 applied_at=EXCLUDED.applied_at,confirmed_by=EXCLUDED.confirmed_by
 WHERE ack.version < EXCLUDED.version;
END $$;
REVOKE ALL ON public.mad_task_limit_policy,public.mad_task_limit_history,public.mad_task_limit_ack FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mad_confirm_task_limit(integer,integer) FROM PUBLIC;

-- Review/replace actual role names. MAD must not own these tables/functions.
-- GRANT SELECT ON public.mad_task_limit_policy,public.mad_task_limit_history,public.mad_task_limit_ack TO mad_runtime;
-- GRANT UPDATE(requested_limit,version,updated_by,updated_at) ON public.mad_task_limit_policy TO mad_runtime;
-- GRANT INSERT ON public.mad_task_limit_history TO mad_runtime;
-- GRANT SELECT ON public.mad_task_limit_policy,public.mad_task_limit_history TO wkms_runtime;
-- SELECT FOR SHARE/UPDATE row locks require an UPDATE privilege in PostgreSQL.
-- Grant only the immutable singleton column; its CHECK/PK prevent alternate keys.
-- GRANT UPDATE(singleton) ON public.mad_task_limit_policy TO wkms_runtime;
-- GRANT EXECUTE ON FUNCTION public.mad_confirm_task_limit(integer,integer) TO wkms_runtime;
-- Never grant MAD acknowledgement writes/confirmation execution, or WKMS value/version/history writes.
-- Revoke inherited/PUBLIC permissions and use separate dedicated login roles.
-- END MAD SECTION: task-limit

-- BEGIN MAD SECTION: tasks
-- DDP-028 / DDP-042: review and run manually. Never run on application startup.

CREATE TABLE IF NOT EXISTS mad_task_versions (
 task_id uuid PRIMARY KEY, version bigint NOT NULL CHECK(version>=0)
);
CREATE TABLE IF NOT EXISTS mad_task_events (
 event_id uuid PRIMARY KEY, task_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>=0), payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS mad_task_events_pending_idx
 ON mad_task_events(received_at,event_id) WHERE delivered_at IS NULL;

-- Replace mad_runtime with the restricted MAD runtime role after review.
-- GRANT SELECT(task_id,room_number,category,priority,status,assigned_worker_id,
-- submitted_at,completed_at,updated_at) ON wkms_tasks TO mad_runtime;
-- GRANT SELECT(worker_id,full_name) ON staff_users TO mad_runtime;
-- GRANT SELECT,INSERT,UPDATE ON mad_task_events,mad_task_versions TO mad_runtime;
-- MAD must have no write privileges on WKMS tasks. Check inherited grants as well.
-- END MAD SECTION: tasks
