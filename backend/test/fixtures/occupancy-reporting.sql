-- Test-only stand-ins for current-state views owned by room/booking providers.
-- Duplicate rows deliberately model joins/replay without duplicating room nights.
CREATE TABLE hw_occupancy_rooms (
  room_id uuid NOT NULL,
  active_from date NOT NULL,
  active_to date,
  updated_at timestamptz NOT NULL DEFAULT '2026-09-26T12:00:00Z',
  CHECK (active_to IS NULL OR active_to > active_from)
);
CREATE TABLE hw_occupancy_allocations (
  allocation_id uuid NOT NULL,
  room_id uuid NOT NULL,
  check_in_date date NOT NULL,
  check_out_date date NOT NULL,
  status text,
  updated_at timestamptz NOT NULL DEFAULT '2026-09-26T12:00:00Z',
  CHECK (check_out_date > check_in_date)
);
CREATE TABLE hw_occupancy_maintenance (
  room_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT '2026-09-26T12:00:00Z',
  CHECK (end_date > start_date)
);
CREATE VIEW mad_occupancy_rooms AS SELECT * FROM hw_occupancy_rooms;
CREATE VIEW mad_occupancy_allocations AS SELECT * FROM hw_occupancy_allocations;
CREATE VIEW mad_occupancy_maintenance AS SELECT * FROM hw_occupancy_maintenance;
