// The provider exposes a current-state reporting view, never an application-owned
// bookings table. All request values are parameters; no input becomes SQL text.
export const BOOKINGS_SQL = `
WITH calendar AS (
  SELECT date_trunc($1, $3::timestamptz AT TIME ZONE $2) AS local_start
), bounds AS (
  SELECT local_start,
    local_start + CASE $1
      WHEN 'day' THEN interval '1 day'
      WHEN 'week' THEN interval '1 week'
      ELSE interval '1 month' END AS local_end
  FROM calendar
), period AS (
  SELECT local_start, local_end,
    local_start AT TIME ZONE $2 AS period_start,
    local_end AT TIME ZONE $2 AS period_end
  FROM bounds
), buckets AS (
  SELECT local_day::date AS bucket_date,
    local_day AT TIME ZONE $2 AS bucket_start,
    (local_day + interval '1 day') AT TIME ZONE $2 AS bucket_end
  FROM period,
    LATERAL generate_series(local_start, local_end - interval '1 day', interval '1 day') local_day
), source AS NOT MATERIALIZED (
  SELECT booking_id, check_in_date, status, updated_at
  FROM public.mad_booking_analytics
), candidates AS (
  SELECT DISTINCT booking_id FROM source, period
  WHERE check_in_date >= local_start::date AND check_in_date < local_end::date
), latest AS (
  SELECT DISTINCT ON (booking_id) booking_id, check_in_date, status, updated_at
  FROM source JOIN candidates USING (booking_id)
  ORDER BY booking_id, updated_at DESC NULLS LAST,
    (COALESCE(status = ANY($4::text[]), false)) ASC,
    status COLLATE "C" ASC, check_in_date ASC
), counts AS (
  SELECT check_in_date AS local_bucket, COUNT(*)::text AS count
  FROM latest, period
  WHERE status = ANY($4::text[])
    AND check_in_date >= local_start::date
    AND check_in_date < local_end::date
  GROUP BY 1
), freshness AS (
  SELECT MAX(updated_at) AS source_updated_at FROM source
)
SELECT period_start, period_end, bucket_start, bucket_end,
  to_char(bucket_date, 'YYYY-MM-DD') AS bucket_date,
  COALESCE(counts.count, '0') AS count,
  source_updated_at, statement_timestamp() AS queried_at
FROM buckets CROSS JOIN period CROSS JOIN freshness
LEFT JOIN counts ON counts.local_bucket = bucket_date
ORDER BY bucket_start ASC
`;
