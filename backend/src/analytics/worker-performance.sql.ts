export const WORKER_PERFORMANCE_SQL = `
WITH calendar AS (
  SELECT date_trunc($1,$3::timestamptz AT TIME ZONE $2) AS local_start
), bounds AS (
  SELECT local_start AT TIME ZONE $2 AS period_start,
    (local_start + CASE $1 WHEN 'day' THEN interval '1 day'
      WHEN 'week' THEN interval '1 week' ELSE interval '1 month' END) AT TIME ZONE $2 AS period_end
  FROM calendar
), tasks AS MATERIALIZED (
  SELECT assigned_worker_id,status,submitted_at,completed_at,updated_at FROM public.wkms_tasks
), workers AS (
  SELECT worker_id,full_name,role,is_active,updated_at FROM public.staff_users s
  WHERE (role='WORKER' OR EXISTS (SELECT 1 FROM tasks t WHERE t.assigned_worker_id=s.worker_id))
    AND ($4::uuid IS NULL OR worker_id=$4::uuid)
), completions AS (
  SELECT assigned_worker_id,count(*) AS completed_count,
    count(*) FILTER (WHERE completed_at>=submitted_at) AS valid_duration_count,
    avg(extract(epoch FROM completed_at-submitted_at)/60)
      FILTER (WHERE completed_at>=submitted_at) AS average_minutes
  FROM tasks,bounds WHERE status='COMPLETED' AND completed_at>=period_start AND completed_at<period_end
  GROUP BY assigned_worker_id
), complaints AS (
  SELECT referenced_worker_id,count(*) AS open_count
  FROM public.foss_complaints WHERE status IN ('SUBMITTED','UNDER_REVIEW') AND submitted_at<=$3::timestamptz
  GROUP BY referenced_worker_id
), quality AS (
  SELECT assigned_worker_id,
    count(*) FILTER (WHERE status='COMPLETED' AND completed_at<submitted_at) AS negative_count,
    count(*) FILTER (WHERE status='COMPLETED' AND completed_at IS NULL) AS missing_count,
    count(*) FILTER (WHERE status<>'COMPLETED' AND completed_at IS NOT NULL) AS unexpected_count
  FROM tasks GROUP BY assigned_worker_id
)
SELECT period_start,period_end,statement_timestamp() AS queried_at,
  greatest((SELECT max(updated_at) FROM workers),(SELECT max(updated_at) FROM tasks),
    (SELECT max(updated_at) FROM public.foss_complaints)) AS source_updated_at,
  coalesce((SELECT jsonb_agg(jsonb_build_object(
    'workerId',w.worker_id,'fullName',w.full_name,'role',w.role,'isActive',w.is_active,
    'completedCount',coalesce(c.completed_count,0)::text,
    'validDurationCount',coalesce(c.valid_duration_count,0)::text,'averageMinutes',c.average_minutes::text,
    'openComplaintCount',coalesce(p.open_count,0)::text,
    'negativeDurationCount',coalesce(q.negative_count,0)::text,
    'missingCompletionCount',coalesce(q.missing_count,0)::text,
    'unexpectedCompletionCount',coalesce(q.unexpected_count,0)::text
  ) ORDER BY w.worker_id)
  FROM workers w LEFT JOIN completions c ON c.assigned_worker_id=w.worker_id
  LEFT JOIN complaints p ON p.referenced_worker_id=w.worker_id
  LEFT JOIN quality q ON q.assigned_worker_id=w.worker_id),'[]'::jsonb) AS workers
FROM bounds
`;
