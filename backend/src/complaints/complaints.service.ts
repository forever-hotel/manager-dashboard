import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { ComplaintQueryDto, ComplaintStatus, ResolveComplaintDto } from './complaint.dto';

export const COMPLAINT_CLOCK = Symbol('COMPLAINT_CLOCK');
export interface ComplaintRow {
  id: string;
  roomNumber: string;
  severity: string;
  workerName: string | null;
  category: string;
  description: string;
  referencedWorkerId: string | null;
  submittedAt: Date;
  status: ComplaintStatus;
  resolvedAt: Date | null;
  version: number;
}
const fields = `c.complaint_id AS id,c.room_number AS "roomNumber",c.severity::text AS severity,
  (SELECT full_name FROM public.staff_users w WHERE w.worker_id=c.referenced_worker_id) AS "workerName",
  c.category,c.description,c.referenced_worker_id AS "referencedWorkerId",
  c.submitted_at AS "submittedAt",c.status,c.resolved_at AS "resolvedAt"`;
const select = `SELECT ${fields},COALESCE(s.version,0) AS version FROM public.foss_complaints c
  LEFT JOIN public.mad_complaint_state s ON s.complaint_id=c.complaint_id`;

export function complaintView(row: ComplaintRow) {
  return {
    id: row.id,
    roomNumber: row.roomNumber,
    severity: row.severity,
    workerName: row.workerName,
    category: row.category,
    description: row.description,
    referencedWorkerId: row.referencedWorkerId,
    submittedAt: row.submittedAt.toISOString(),
    status: row.status,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    version: row.version
  };
}

export function requireTransition(from: ComplaintStatus, to: ResolveComplaintDto['status']) {
  if (!((from === 'SUBMITTED' && to === 'UNDER_REVIEW') || (from === 'UNDER_REVIEW' && to === 'RESOLVED')))
    throw new BadRequestException(
      'Use SUBMITTED -> UNDER_REVIEW -> RESOLVED. Reopening and repeated transitions are not allowed.'
    );
}

@Injectable()
export class ComplaintsService {
  constructor(
    private readonly database: DataSource,
    @Inject(COMPLAINT_CLOCK) private readonly now: () => Date
  ) {}

  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      // Never expose internal notes, database errors or recipient details.
      throw new ServiceUnavailableException();
    }
  }

  list(query: ComplaintQueryDto) {
    if (query.date && !query.period) throw new BadRequestException('A period is required with a date.');
    return this.guarded(() =>
      this.database.transaction('REPEATABLE READ', async manager => {
        const values: unknown[] = [],
          filters: string[] = [];
        let summary: { open: number; review: number; resolved: number; averageMinutes: number | null } | undefined;

        if (query.period) {
          const anchor = query.date ? `${query.date}T12:00:00.000Z` : this.now().toISOString();
          const [bounds] = await manager.query<{ start: Date; end: Date }[]>(
            `SELECT local_start AT TIME ZONE 'Asia/Colombo' AS start,
              (local_start + CASE $1 WHEN 'day' THEN interval '1 day' WHEN 'week' THEN interval '1 week' ELSE interval '1 month' END)
                AT TIME ZONE 'Asia/Colombo' AS end
             FROM (SELECT date_trunc($1,$2::timestamptz AT TIME ZONE 'Asia/Colombo') AS local_start) b`,
            [query.period, anchor]
          );

          values.push(bounds.start, bounds.end);
          filters.push('c.submitted_at >= $1 AND c.submitted_at < $2');
          const [stats] = await manager.query<
            { open: string; review: string; resolved: string; average: string | null }[]
          >(
            `SELECT count(*) FILTER(WHERE status='SUBMITTED' AND submitted_at >= $1 AND submitted_at < $2)::text AS open,
              count(*) FILTER(WHERE status='UNDER_REVIEW' AND submitted_at >= $1 AND submitted_at < $2)::text AS review,
              count(*) FILTER(WHERE status='RESOLVED' AND resolved_at >= $1 AND resolved_at < $2)::text AS resolved,
              avg(extract(epoch FROM resolved_at-submitted_at)/60) FILTER(WHERE status='RESOLVED'
                AND resolved_at >= $1 AND resolved_at < $2 AND resolved_at >= submitted_at)::text AS average
             FROM public.foss_complaints`,
            [bounds.start, bounds.end]
          );

          summary = {
            open: Number(stats.open),
            review: Number(stats.review),
            resolved: Number(stats.resolved),
            averageMinutes: stats.average === null ? null : Math.round(Number(stats.average) * 100) / 100
          };
          if (
            [summary.open, summary.review, summary.resolved].some(value => !Number.isSafeInteger(value) || value < 0) ||
            (summary.averageMinutes !== null &&
              (!Number.isFinite(summary.averageMinutes) || summary.averageMinutes < 0))
          )
            throw new Error('Invalid complaint metrics');
        }
        for (const [column, value] of [
          ['c.status', query.status],
          ['c.category', query.category],
          ['c.referenced_worker_id', query.workerId]
        ]) {
          if (value !== undefined) {
            values.push(value);
            filters.push(`${column}=$${values.length}`);
          }
        }
        const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
        const [count] = await manager.query<{ total: string }[]>(
          'SELECT count(*) AS total FROM public.foss_complaints c' + where,
          values
        );
        const rows = await manager.query<ComplaintRow[]>(
          select +
            where +
            ` ORDER BY c.submitted_at DESC,c.complaint_id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, query.pageSize, (query.page - 1) * query.pageSize]
        );

        return {
          items: rows.map(complaintView),
          total: Number(count.total),
          page: query.page,
          pageSize: query.pageSize,
          ...(summary ? { summary } : {})
        };
      })
    );
  }

  detail(id: string) {
    return this.guarded(() =>
      this.database.transaction('REPEATABLE READ', async manager => {
        const [row] = await manager.query<ComplaintRow[]>(select + ' WHERE c.complaint_id=$1', [id]);

        if (!row) throw new NotFoundException('Complaint not found.');
        const history = await manager.query<
          {
            version: number;
            fromStatus: ComplaintStatus;
            status: ComplaintStatus;
            note: string;
            actorId: string;
            recordedAt: Date;
          }[]
        >(
          `SELECT version,from_status AS "fromStatus",to_status AS status,note,actor_id AS "actorId",recorded_at AS "recordedAt"
        FROM public.mad_complaint_history WHERE complaint_id=$1 ORDER BY version`,
          [id]
        );

        return {
          ...complaintView(row),
          history: history.map(entry => ({
            ...entry,
            recordedAt: entry.recordedAt.toISOString()
          }))
        };
      })
    );
  }

  update(id: string, actorId: string, input: ResolveComplaintDto) {
    return this.guarded(() =>
      this.database.transaction(async manager => {
        // Lock the owner row first. Read MAD's version in a NEW statement after the
        // lock is acquired so a waiting concurrent writer sees the committed version.
        const [row] = await manager.query<ComplaintRow[]>(
          `SELECT ${fields} FROM public.foss_complaints c WHERE c.complaint_id=$1 FOR UPDATE OF c`,
          [id]
        );

        if (!row) throw new NotFoundException('Complaint not found.');
        const [state] = await manager.query<{ version: number }[]>(
          'SELECT version FROM public.mad_complaint_state WHERE complaint_id=$1',
          [id]
        );
        const version = state?.version ?? 0;

        if (version !== input.version) throw new ConflictException('Complaint changed. Reload before retrying.');
        requireTransition(row.status, input.status);
        const now = this.now(),
          nextVersion = version + 1;
        const resolvedAt = input.status === 'RESOLVED' ? now : null;
        // Field-level ownership: no creation, guest-field edits or shared notes.
        await manager.query('UPDATE public.foss_complaints SET status=$2,resolved_at=$3 WHERE complaint_id=$1', [
          id,
          input.status,
          resolvedAt
        ]);
        await manager.query(
          `INSERT INTO public.mad_complaint_state(complaint_id,version) VALUES ($1,$2)
        ON CONFLICT(complaint_id) DO UPDATE SET version=EXCLUDED.version`,
          [id, nextVersion]
        );
        await manager.query(
          `INSERT INTO public.mad_complaint_history(complaint_id,version,from_status,to_status,note,actor_id,recorded_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, nextVersion, row.status, input.status, input.note, actorId, now]
        );
        // Durable, note-free events support later notification/count consumers.
        await manager.query(
          `INSERT INTO public.mad_complaint_outbox(event_id,complaint_id,version,payload,created_at)
        VALUES ($1,$2,$3,$4::jsonb,$5)`,
          [
            randomUUID(),
            id,
            nextVersion,
            JSON.stringify({
              type: 'complaint.status_changed',
              complaintId: id,
              version: nextVersion,
              previousStatus: row.status,
              status: input.status,
              referencedWorkerId: row.referencedWorkerId,
              occurredAt: now.toISOString()
            }),
            now
          ]
        );
        return complaintView({
          ...row,
          status: input.status,
          resolvedAt,
          version: nextVersion
        });
      })
    );
  }
}
