// Provider-owned current-state views. Dates are hotel-local DATE values;
// expand timestamp-without-time-zone dates so the connection timezone cannot
// change the calendar. Query values are always bound parameters.
export const OCCUPANCY_SQL = `
WITH dates AS (
  SELECT day::date AS stay_date
  FROM generate_series($1::date::timestamp, $2::date::timestamp, interval '1 day') day
), rooms AS (
  SELECT DISTINCT room_id, active_from, active_to
  FROM public.mad_occupancy_rooms
), allocations AS (
  SELECT DISTINCT room_id, check_in_date, check_out_date
  FROM public.mad_occupancy_allocations
  WHERE status = ANY($3::text[])
    AND check_in_date <= $2::date AND check_out_date > $1::date
), eligible AS (
  SELECT DISTINCT d.stay_date, r.room_id
  FROM dates d JOIN rooms r
    ON r.active_from <= d.stay_date
    AND (r.active_to IS NULL OR d.stay_date < r.active_to)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.mad_occupancy_maintenance m
    WHERE m.room_id = r.room_id
      AND m.start_date <= d.stay_date AND d.stay_date < m.end_date
  )
), nights AS (
  SELECT e.stay_date, e.room_id, EXISTS (
    SELECT 1 FROM allocations a
    WHERE a.room_id = e.room_id AND a.check_in_date <= e.stay_date
      AND e.stay_date < a.check_out_date
  ) AS occupied
  FROM eligible e
), freshness AS (
  SELECT MAX(updated_at) AS source_updated_at FROM (
    SELECT MAX(updated_at) AS updated_at FROM public.mad_occupancy_rooms
    UNION ALL
    SELECT MAX(updated_at) FROM public.mad_occupancy_allocations
    UNION ALL
    SELECT MAX(updated_at) FROM public.mad_occupancy_maintenance
  ) updates
)
SELECT to_char(d.stay_date, 'YYYY-MM-DD') AS date,
  COUNT(n.room_id)::text AS eligible_rooms,
  COUNT(n.room_id) FILTER (WHERE n.occupied)::text AS occupied_rooms,
  f.source_updated_at, statement_timestamp() AS queried_at
FROM dates d LEFT JOIN nights n ON n.stay_date = d.stay_date
CROSS JOIN freshness f
GROUP BY d.stay_date, f.source_updated_at
ORDER BY d.stay_date ASC
`;
