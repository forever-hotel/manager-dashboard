export const SERVICE_REQUEST_LIST_SQL = `
WITH bounds AS (
 SELECT date_trunc($1,$3::timestamptz AT TIME ZONE $2) AS start
), filtered AS MATERIALIZED (
 SELECT r.request_id,r.room_number,r.category::text,r.status::text,r.submitted_at,
   s.full_name AS assignee
 FROM public.foss_service_requests r
 LEFT JOIN public.wkms_tasks t ON t.service_request_id=r.request_id
 LEFT JOIN public.staff_users s ON s.worker_id=t.assigned_worker_id
 CROSS JOIN bounds
 WHERE r.submitted_at>=start AT TIME ZONE $2
   AND r.submitted_at<(start + CASE $1 WHEN 'day' THEN interval '1 day'
     WHEN 'week' THEN interval '1 week' ELSE interval '1 month' END) AT TIME ZONE $2
   AND ($4='all' OR r.status::text IN ('SUBMITTED','ASSIGNED','IN_PROGRESS'))
), page AS (
 SELECT * FROM filtered ORDER BY submitted_at DESC,request_id LIMIT $5 OFFSET $6
)
SELECT (SELECT count(*)::text FROM filtered) AS total,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',request_id,'roomNumber',room_number,
   'category',category,'status',status,'submittedAt',submitted_at,'assignee',assignee)
   ORDER BY submitted_at DESC,request_id) FROM page),'[]'::jsonb) AS requests
`;
