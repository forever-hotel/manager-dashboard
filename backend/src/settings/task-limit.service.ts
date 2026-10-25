import { ConflictException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { UpdateTaskLimitDto } from './task-limit.dto';
export const TASK_LIMIT_ACTIVE_STATES = ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED'] as const;
export interface TaskLimitRow {
  requested_limit: number;
  version: number;
  updated_at: Date;
  effective_limit: number | null;
  effective_version: number | null;
  applied_at: Date | null;
}
export const TASK_LIMIT_SQL = `SELECT p.requested_limit,p.version,p.updated_at,a.task_limit AS effective_limit,a.version AS effective_version,a.applied_at
 FROM public.mad_task_limit_policy p LEFT JOIN public.mad_task_limit_ack a USING(singleton) WHERE p.singleton`;
function limit(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 10;
}
function version(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2147483647;
}
export function taskLimitView(row: TaskLimitRow | undefined) {
  if (
    !row ||
    !limit(row.requested_limit) ||
    !version(row.version) ||
    !(row.updated_at instanceof Date) ||
    !Number.isFinite(row.updated_at.getTime())
  )
    throw new Error('Invalid policy');
  if (row.effective_version === null) {
    if (row.effective_limit !== null || row.applied_at !== null) throw new Error('Invalid confirmation');
  } else if (
    !version(row.effective_version) ||
    row.effective_version > row.version ||
    !limit(row.effective_limit) ||
    !(row.applied_at instanceof Date) ||
    !Number.isFinite(row.applied_at.getTime()) ||
    (row.effective_version === row.version && row.effective_limit !== row.requested_limit)
  )
    throw new Error('Invalid confirmation');
  return {
    limit: row.requested_limit,
    version: row.version,
    updatedAt: row.updated_at.toISOString(),
    effectiveLimit: row.effective_limit,
    effectiveVersion: row.effective_version,
    confirmedAt: row.applied_at?.toISOString() ?? null,
    status: row.effective_version === row.version ? ('EFFECTIVE' as const) : ('PENDING' as const),
    defaultLimit: 3 as const,
    minLimit: 1 as const,
    maxLimit: 10 as const,
    activeStates: [...TASK_LIMIT_ACTIVE_STATES],
    assignedWorkerRequired: true as const
  };
}
@Injectable()
export class TaskLimitService {
  constructor(private readonly database: DataSource) {}
  private async read(db: DataSource | EntityManager) {
    const rows = await db.query<TaskLimitRow[]>(TASK_LIMIT_SQL);
    if (rows.length !== 1) throw new Error('Missing policy');
    return taskLimitView(rows[0]);
  }
  async get() {
    try {
      return await this.read(this.database);
    } catch {
      throw new ServiceUnavailableException();
    }
  }
  async update(input: UpdateTaskLimitDto, actor: string) {
    try {
      return await this.database.transaction('READ COMMITTED', async db => {
        // Lock order shared by MAD updates, WKMS activation and WKMS claims.
        const rows = await db.query<TaskLimitRow[]>(TASK_LIMIT_SQL + ' FOR UPDATE OF p');
        if (rows.length !== 1) throw new Error('Missing policy');
        const current = taskLimitView(rows[0]);
        if (current.version !== input.version || current.version === 2147483647)
          throw new ConflictException('Task limit changed. Reload the current version before saving.');
        if (current.limit === input.limit) return current;
        await db.query(
          `INSERT INTO public.mad_task_limit_history(version,task_limit,changed_by,changed_at) VALUES($1,$2,$3,clock_timestamp())`,
          [current.version + 1, input.limit, actor]
        );
        await db.query(
          `UPDATE public.mad_task_limit_policy SET requested_limit=$1,version=$2,updated_by=$3,updated_at=clock_timestamp() WHERE singleton`,
          [input.limit, current.version + 1, actor]
        );
        return this.read(db);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException();
    }
  }
}
