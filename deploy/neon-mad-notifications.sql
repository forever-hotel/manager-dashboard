-- DDP-043. Review and apply manually after auth and complaint supplements.
-- Never executed by application startup. Does not modify source issues.
BEGIN;
CREATE TABLE IF NOT EXISTS public.mad_notification_reads (
 manager_id uuid NOT NULL REFERENCES public.staff_users(worker_id),
 type text NOT NULL CHECK(type IN ('COMPLAINT','STOCK')),
 entity_id uuid NOT NULL,
 revision varchar(100) NOT NULL CHECK(revision ~ '^[A-Z0-9:_-]{1,100}$'),
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(manager_id,type,entity_id)
);
REVOKE ALL ON public.mad_notification_reads FROM PUBLIC;
COMMIT;
-- Replace mad_runtime with the reviewed dedicated MAD runtime role:
-- GRANT SELECT,INSERT,UPDATE ON public.mad_notification_reads TO mad_runtime;
-- GRANT SELECT(complaint_id,category,status,submitted_at) ON public.foss_complaints TO mad_runtime;
-- GRANT SELECT(complaint_id,version) ON public.mad_complaint_state TO mad_runtime;
-- GRANT SELECT(menu_item_id,name,stock_status,updated_at) ON public.kms_menu_items TO mad_runtime;
-- No source INSERT/UPDATE/DELETE privileges are required for notifications.
