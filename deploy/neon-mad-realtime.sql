-- DDP-039: manually apply after owner review. Never run at application startup.
BEGIN;
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
COMMIT;
-- Substitute your restricted MAD role; do not grant these to guest/FOSS/KMS roles.
-- GRANT SELECT,INSERT,UPDATE ON mad_realtime_events,mad_realtime_versions TO mad_runtime;
-- GRANT SELECT(order_id,room_number,meal_period,status,placed_at,updated_at,delivered_at)
--   ON kms_food_orders TO mad_runtime;
-- GRANT SELECT(order_id,quantity) ON kms_food_order_items TO mad_runtime;
