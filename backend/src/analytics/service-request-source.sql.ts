// WMS owns execution progress. The original request can retain its submitted state.
// Unlinked requests continue to use their own lifecycle fields.
export const SERVICE_REQUEST_SOURCE_SQL = `
 SELECT r.request_id,r.room_number,r.category,r.submitted_at,
   CASE t.status::text
     WHEN 'UNASSIGNED' THEN 'SUBMITTED'
     WHEN 'ESCALATED' THEN 'SUBMITTED'
     WHEN 'ASSIGNED' THEN 'ASSIGNED'
     WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
     WHEN 'COMPLETED' THEN 'COMPLETED'
     ELSE r.status::text END AS status,
   CASE WHEN t.service_request_id IS NOT NULL THEN t.completed_at ELSE r.completed_at END AS completed_at,
   greatest(r.updated_at,t.updated_at) AS updated_at,
   t.assigned_worker_id
 FROM public.foss_service_requests r
 LEFT JOIN public.wkms_tasks t ON t.service_request_id=r.request_id
`;
