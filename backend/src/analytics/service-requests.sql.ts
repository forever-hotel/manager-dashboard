export const SERVICE_REQUESTS_SQL = `
WITH calendar AS (
  SELECT date_trunc($1,$3::timestamptz AT TIME ZONE $2) AS local_start
), bounds AS (
  SELECT local_start,local_start + CASE $1 WHEN 'day' THEN interval '1 day'
    WHEN 'week' THEN interval '1 week' ELSE interval '1 month' END AS local_end FROM calendar
), period AS (
  SELECT *,local_start AT TIME ZONE $2 AS period_start,local_end AT TIME ZONE $2 AS period_end FROM bounds
), source AS MATERIALIZED (
  SELECT request_id,status::text AS status,submitted_at,completed_at,updated_at FROM public.foss_service_requests
), submitted AS (
  SELECT s.* FROM source s,period WHERE submitted_at>=period_start AND submitted_at<period_end
), completed AS (
  SELECT s.* FROM source s,period WHERE status='COMPLETED' AND completed_at>=period_start AND completed_at<period_end
), valid_completed AS (
  SELECT * FROM completed WHERE completed_at>=submitted_at
), days AS (
  SELECT day::date AS date FROM period,LATERAL generate_series(local_start,local_end-interval '1 day',interval '1 day') day
), daily AS (
  SELECT (submitted_at AT TIME ZONE $2)::date AS date,count(*) AS count FROM submitted GROUP BY 1
)
SELECT period_start,period_end,
  (SELECT count(*)::text FROM submitted) AS total,
  (SELECT count(*)::text FROM completed) AS completed_count,
  (SELECT count(*)::text FROM valid_completed) AS valid_duration_count,
  (SELECT avg(extract(epoch FROM completed_at-submitted_at)/60)::text FROM valid_completed) AS average_minutes,
  (SELECT count(*)::text FROM source WHERE status IN ('SUBMITTED','ASSIGNED','IN_PROGRESS') AND submitted_at<=$4::timestamptz) AS unresolved_count,
  (SELECT count(*)::text FROM source WHERE status='COMPLETED' AND completed_at<submitted_at) AS negative_duration_count,
  (SELECT count(*)::text FROM source WHERE status='COMPLETED' AND completed_at IS NULL) AS missing_completion_count,
  (SELECT count(*)::text FROM source WHERE status<>'COMPLETED' AND completed_at IS NOT NULL) AS unexpected_completion_count,
  (SELECT jsonb_agg(jsonb_build_object('status',state,'count',(SELECT count(*)::text FROM submitted WHERE status=state)) ORDER BY ord)
    FROM unnest(ARRAY['SUBMITTED','ASSIGNED','IN_PROGRESS','COMPLETED']) WITH ORDINALITY AS states(state,ord)) AS statuses,
  (SELECT jsonb_agg(jsonb_build_object('date',to_char(days.date,'YYYY-MM-DD'),'count',coalesce(daily.count,0)::text) ORDER BY days.date)
    FROM days LEFT JOIN daily USING(date)) AS trend,
  (SELECT max(updated_at) FROM source) AS source_updated_at,statement_timestamp() AS queried_at
FROM period
`;
