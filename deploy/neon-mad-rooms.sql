-- DDP-027: manual MAD-only supplement. Do not execute at application startup.
BEGIN;
CREATE TABLE IF NOT EXISTS mad_room_versions (
 room_id varchar(10) PRIMARY KEY, version bigint NOT NULL CHECK(version>=0)
);
CREATE TABLE IF NOT EXISTS mad_room_events (
 event_id uuid PRIMARY KEY, room_id varchar(10) NOT NULL,
 version bigint NOT NULL CHECK(version>=0), payload jsonb NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS mad_room_events_pending_idx ON mad_room_events(received_at,event_id) WHERE delivered_at IS NULL;
COMMIT;
-- Replace mad_runtime with your restricted runtime role after review:
-- GRANT SELECT(room_number,room_type_id,floor,status,updated_at) ON rooms TO mad_runtime;
-- GRANT SELECT(room_type_id,type_name) ON room_types TO mad_runtime;
-- GRANT SELECT,INSERT,UPDATE ON mad_room_events,mad_room_versions TO mad_runtime;
