// TEST-ONLY reference contract. Not imported by MAD runtime or a deployed WKMS.
// WKMS must authenticate/authorize the worker before using its own claim command.
import { DataSource } from 'typeorm';
export async function applyWkmsTaskLimit(database: DataSource) {
  return database.transaction('READ COMMITTED', async (db) => {
    const [request] = await db.query<
      { version: number; requested_limit: number }[]
    >(
      'SELECT version,requested_limit FROM public.mad_task_limit_policy WHERE singleton FOR UPDATE',
    );
    if (!request) throw new Error('Missing requested policy');
    await db.query(
      `INSERT INTO public.wkms_effective_task_policy(singleton,version,task_limit) VALUES(true,$1,$2) ON CONFLICT(singleton) DO UPDATE SET version=EXCLUDED.version,task_limit=EXCLUDED.task_limit`,
      [request.version, request.requested_limit],
    );
    await db.query('SELECT public.mad_confirm_task_limit($1,$2)', [
      request.version,
      request.requested_limit,
    ]);
    return request;
  });
}
export async function claimWkmsTask(
  database: DataSource,
  workerId: string,
  taskId: string,
) {
  return database.transaction('READ COMMITTED', async (db) => {
    // Shared policy lock prevents application/confirmation crossing this claim.
    const requested = await db.query<{ version: number }[]>(
      'SELECT version FROM public.mad_task_limit_policy WHERE singleton FOR SHARE',
    );
    if (requested.length !== 1) throw new Error('Missing requested policy');
    const [policy] = await db.query<{ task_limit: number }[]>(
      'SELECT task_limit FROM public.wkms_effective_task_policy WHERE singleton FOR SHARE',
    );
    if (!policy) throw new Error('WKMS policy not initialized');
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('wkms-worker:'||$1::uuid::text,0))",
      [workerId],
    );
    const [load] = await db.query<{ total: string }[]>(
      "SELECT count(*)::text AS total FROM public.wkms_tasks WHERE assigned_worker_id=$1 AND status IN ('ASSIGNED','IN_PROGRESS','ESCALATED')",
      [workerId],
    );
    if (Number(load.total) >= policy.task_limit)
      throw new Error('ACTIVE_TASK_LIMIT');
    const rows = await db.query<{ task_id: string }[]>(
      "UPDATE public.wkms_tasks SET assigned_worker_id=$1,status='ASSIGNED' WHERE task_id=$2 AND status='UNASSIGNED' AND assigned_worker_id IS NULL RETURNING task_id",
      [workerId, taskId],
    );
    if (rows.length !== 1) throw new Error('TASK_UNAVAILABLE');
    return rows[0];
  });
}
