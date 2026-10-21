-- DDP-045: review/apply manually after the shared staff/auth schema.
-- No task rows are changed. Never run at application startup.
BEGIN;
CREATE TABLE IF NOT EXISTS public.mad_task_limit_history (
 version integer PRIMARY KEY CHECK(version>=0),
 task_limit smallint NOT NULL CHECK(task_limit BETWEEN 1 AND 10),
 changed_by uuid REFERENCES public.staff_users(worker_id),
 changed_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(version,task_limit)
);
INSERT INTO public.mad_task_limit_history(version,task_limit) VALUES(0,3) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.mad_task_limit_policy (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 requested_limit smallint NOT NULL CHECK(requested_limit BETWEEN 1 AND 10),
 version integer NOT NULL CHECK(version>=0),
 updated_by uuid REFERENCES public.staff_users(worker_id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(version,requested_limit) REFERENCES public.mad_task_limit_history(version,task_limit) DEFERRABLE INITIALLY DEFERRED
);
INSERT INTO public.mad_task_limit_policy(singleton,requested_limit,version) VALUES(true,3,0) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.mad_task_limit_ack (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 version integer NOT NULL CHECK(version>=0),
 task_limit smallint NOT NULL CHECK(task_limit BETWEEN 1 AND 10),
 applied_at timestamptz NOT NULL DEFAULT now(),
 confirmed_by name NOT NULL,
 FOREIGN KEY(version,task_limit) REFERENCES public.mad_task_limit_history(version,task_limit)
);
-- WKMS calls this in the SAME transaction as activating its claim-enforced policy.
-- It must lock mad_task_limit_policy first and use the same lock order for claims.
CREATE OR REPLACE FUNCTION public.mad_confirm_task_limit(expected_version integer, applied_limit integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE policy public.mad_task_limit_policy%ROWTYPE;
BEGIN
 SELECT * INTO policy FROM public.mad_task_limit_policy WHERE singleton FOR UPDATE;
 IF NOT FOUND OR expected_version IS DISTINCT FROM policy.version OR applied_limit IS DISTINCT FROM policy.requested_limit THEN
  RAISE EXCEPTION 'TASK_LIMIT_POLICY_CHANGED' USING ERRCODE='40001';
 END IF;
 INSERT INTO public.mad_task_limit_ack AS ack(singleton,version,task_limit,applied_at,confirmed_by)
 VALUES(true,expected_version,applied_limit,clock_timestamp(),session_user)
 ON CONFLICT(singleton) DO UPDATE SET version=EXCLUDED.version,task_limit=EXCLUDED.task_limit,
 applied_at=EXCLUDED.applied_at,confirmed_by=EXCLUDED.confirmed_by
 WHERE ack.version < EXCLUDED.version;
END $$;
REVOKE ALL ON public.mad_task_limit_policy,public.mad_task_limit_history,public.mad_task_limit_ack FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mad_confirm_task_limit(integer,integer) FROM PUBLIC;
COMMIT;
-- Review/replace actual role names. MAD must not own these tables/functions.
-- GRANT SELECT ON public.mad_task_limit_policy,public.mad_task_limit_history,public.mad_task_limit_ack TO mad_runtime;
-- GRANT UPDATE(requested_limit,version,updated_by,updated_at) ON public.mad_task_limit_policy TO mad_runtime;
-- GRANT INSERT ON public.mad_task_limit_history TO mad_runtime;
-- GRANT SELECT ON public.mad_task_limit_policy,public.mad_task_limit_history TO wkms_runtime;
-- SELECT FOR SHARE/UPDATE row locks require an UPDATE privilege in PostgreSQL.
-- Grant only the immutable singleton column; its CHECK/PK prevent alternate keys.
-- GRANT UPDATE(singleton) ON public.mad_task_limit_policy TO wkms_runtime;
-- GRANT EXECUTE ON FUNCTION public.mad_confirm_task_limit(integer,integer) TO wkms_runtime;
-- Never grant MAD acknowledgement writes/confirmation execution, or WKMS value/version/history writes.
-- Revoke inherited/PUBLIC permissions and use separate dedicated login roles.
