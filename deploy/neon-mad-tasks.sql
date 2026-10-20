-- DDP-028 / DDP-042: review and run manually. Never run on application startup.
BEGIN;
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
COMMIT;
-- Replace mad_runtime with the restricted MAD runtime role after review.
-- GRANT SELECT(task_id,room_number,category,priority,status,assigned_worker_id,
-- submitted_at,completed_at,updated_at) ON wkms_tasks TO mad_runtime;
-- GRANT SELECT(worker_id,full_name) ON staff_users TO mad_runtime;
-- GRANT SELECT,INSERT,UPDATE ON mad_task_events,mad_task_versions TO mad_runtime;
-- MAD must have no write privileges on WKMS tasks. Check inherited grants as well.
