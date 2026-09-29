-- Test-only provider data. Duplicate versions model delivery/replay and join duplication.
CREATE TABLE hw_booking_snapshots (
  booking_id uuid NOT NULL,
  check_in_date date NOT NULL,
  status text NOT NULL,
  updated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT '2020-01-01T00:00:00Z'
);
CREATE VIEW mad_booking_analytics AS
  SELECT booking_id, check_in_date, status, updated_at FROM hw_booking_snapshots;
