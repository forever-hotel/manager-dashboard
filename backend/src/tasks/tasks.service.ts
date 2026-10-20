import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { TasksQueryDto } from './tasks-query.dto';

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
        row.total < 0
      )
        throw new Error();
      for (const task of row.tasks) {
        if (
          !isUUID(task.id) ||
          typeof task.roomNumber !== 'string' ||
          !task.roomNumber.length ||
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
            (!isUUID(task.assignee.id) ||
              typeof task.assignee.name !== 'string')) ||
          !Number.isSafeInteger(task.version) ||
          task.version < 0 ||
          !Number.isFinite(Date.parse(task.updatedAt)) ||
          !Number.isFinite(Date.parse(task.submittedAt)) ||
          (task.status === 'COMPLETED'
            ? !task.completedAt ||
              !Number.isFinite(Date.parse(task.completedAt))
            : task.completedAt !== null)
        )
          throw new Error();
      }
      return {
        tasks: row.tasks,
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
