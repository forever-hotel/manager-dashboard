-- MANUAL ONLY: review and apply after forever_hotel_full_schema.sql.
-- Application startup and Compose never execute this file.
BEGIN;

-- Apply neon-mad-auth.sql first for login/readiness support.

CREATE OR REPLACE VIEW public.mad_booking_analytics AS
SELECT booking_id, check_in_date, status::text AS status, updated_at
FROM public.bookings;

-- The supplied schema has no room activation/retirement or dated maintenance.
-- Owners must supply actual dates. No history is inferred or seeded here.
CREATE TABLE IF NOT EXISTS public.mad_room_availability (
  room_number varchar(10) PRIMARY KEY REFERENCES public.rooms(room_number),
  active_from date NOT NULL,
  active_to date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (active_to IS NULL OR active_to > active_from)
);
CREATE TABLE IF NOT EXISTS public.mad_room_maintenance (
  maintenance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_number varchar(10) NOT NULL REFERENCES public.rooms(room_number),
  start_date date NOT NULL,
  end_date date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date)
);
REVOKE ALL ON public.mad_room_availability, public.mad_room_maintenance FROM PUBLIC;

CREATE OR REPLACE VIEW public.mad_occupancy_rooms AS
SELECT r.room_number AS room_id, a.active_from, a.active_to,
       greatest(r.updated_at, a.updated_at) AS updated_at
FROM public.rooms r LEFT JOIN public.mad_room_availability a USING (room_number);

CREATE OR REPLACE VIEW public.mad_occupancy_allocations AS
SELECT booking_id, room_number AS room_id, check_in_date, check_out_date,
       status::text AS status, updated_at
FROM public.bookings WHERE room_number IS NOT NULL;

CREATE OR REPLACE VIEW public.mad_occupancy_maintenance AS
SELECT room_number AS room_id, start_date, end_date, updated_at
FROM public.mad_room_maintenance;

COMMIT;
