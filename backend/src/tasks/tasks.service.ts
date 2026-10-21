import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isISO8601, isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { TasksQueryDto } from './tasks-query.dto';

function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    isISO8601(value, { strict: true }) &&
    /(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function label(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    Boolean(value.trim()) &&
    value.length <= maximum &&
    !/\p{Cc}/u.test(value)
  );
}

export interface WorkerTask {
  id: string;
  roomNumber: string;
  category: string;
  priority: string;
  status: string;
  assignee: { id: string; name: string } | null;
  submittedAt: string;
  updatedAt: string;
  completedAt: string | null;
  version: number;
}
export const TASKS_SQL = `WITH filtered AS MATERIALIZED (
 SELECT t.task_id,t.room_number,t.category,t.priority,t.status,t.assigned_worker_id,t.submitted_at,t.completed_at,t.updated_at,s.full_name FROM public.wkms_tasks t
 LEFT JOIN public.staff_users s ON s.worker_id=t.assigned_worker_id
 WHERE ($1::text IS NULL OR t.status::text=$1)
 AND ($2::uuid IS NULL OR t.assigned_worker_id=$2)
 AND ($5::uuid IS NULL OR t.task_id=$5)
), page AS (
 SELECT * FROM filtered ORDER BY submitted_at DESC,task_id LIMIT $3 OFFSET $4
)
SELECT statement_timestamp() AS queried_at,(SELECT count(*)::integer FROM filtered) AS total,
 coalesce((SELECT jsonb_agg(jsonb_build_object(
 'id',task_id,'roomNumber',room_number,'category',category,'priority',priority,'status',status,
 'assignee',CASE WHEN assigned_worker_id IS NULL THEN NULL ELSE jsonb_build_object('id',assigned_worker_id,'name',full_name) END,
 'submittedAt',submitted_at,'updatedAt',updated_at,'completedAt',completed_at,
 'version',(extract(epoch FROM updated_at)*1000000)::bigint
 ) ORDER BY submitted_at DESC,task_id) FROM page),'[]'::jsonb) AS tasks`;

@Injectable()
export class TasksService {
  constructor(private readonly database: DataSource) {}
  async snapshot(query: TasksQueryDto, id?: string) {
    try {
      const [row] = await this.database.query<
        { queried_at: Date; total: number; tasks: WorkerTask[] }[]
      >(TASKS_SQL, [
        query.status ?? null,
        query.worker ?? null,
        query.pageSize,
        (query.page - 1) * query.pageSize,
        id ?? null,
      ]);
      if (
        !row ||
        !Array.isArray(row.tasks) ||
        !Number.isSafeInteger(row.total) ||
        row.total < 0 ||
        !(row.queried_at instanceof Date) ||
        !Number.isFinite(row.queried_at.getTime()) ||
        row.tasks.length !==
          Math.min(
            query.pageSize,
            Math.max(0, row.total - (query.page - 1) * query.pageSize),
          ) ||
        (id !== undefined && row.total > 1)
      )
        throw new Error();
      const seen = new Set<string>();
      const tasks: WorkerTask[] = [];
      for (const task of row.tasks) {
        if (
          !task ||
          typeof task !== 'object' ||
          typeof task.id !== 'string' ||
          !isUUID(task.id) ||
          seen.has(task.id.toLowerCase()) ||
          (id !== undefined && task.id.toLowerCase() !== id.toLowerCase()) ||
          (query.status !== undefined && task.status !== query.status) ||
          (query.worker !== undefined &&
            task.assignee?.id?.toLowerCase() !== query.worker.toLowerCase()) ||
          !label(task.roomNumber, 10) ||
          ![
            'ROOM_CLEANING',
            'EXTRA_TOWELS',
            'WATER_BOTTLES',
            'MAINTENANCE',
            'LAUNDRY',
            'FOOD_DELIVERY',
            'OTHER',
          ].includes(task.category) ||
          !['HIGH', 'NORMAL'].includes(task.priority) ||
          ![
            'UNASSIGNED',
            'ASSIGNED',
            'IN_PROGRESS',
            'COMPLETED',
            'ESCALATED',
          ].includes(task.status) ||
          (task.assignee !== null &&
            (!task.assignee ||
              typeof task.assignee.id !== 'string' ||
              !isUUID(task.assignee.id) ||
              !label(task.assignee.name, 200))) ||
          !Number.isSafeInteger(task.version) ||
          task.version < 0 ||
          !timestamp(task.updatedAt) ||
          !timestamp(task.submittedAt) ||
          (task.status === 'COMPLETED'
            ? !task.completedAt || !timestamp(task.completedAt)
            : task.completedAt !== null)
        )
          throw new Error();
        const fraction =
          /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/.exec(task.updatedAt)?.[1] ?? '';
        if (
          fraction.length > 6 ||
          task.version !==
            Date.parse(task.updatedAt) * 1000 +
              Number(fraction.padEnd(6, '0').slice(3))
        )
          throw new Error();
        seen.add(task.id.toLowerCase());
        tasks.push({
          id: task.id,
          roomNumber: task.roomNumber,
          category: task.category,
          priority: task.priority,
          status: task.status,
          assignee:
            task.assignee === null
              ? null
              : { id: task.assignee.id, name: task.assignee.name },
          submittedAt: task.submittedAt,
          updatedAt: task.updatedAt,
          completedAt: task.completedAt,
          version: task.version,
        });
      }
      return {
        tasks,
        total: row.total,
        queriedAt: row.queried_at.toISOString(),
        page: query.page,
        pageSize: query.pageSize,
        source: 'WKMS',
        readOnly: true,
      };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  async find(id: string) {
    return (await this.snapshot(new TasksQueryDto(), id)).tasks[0];
  }
}
