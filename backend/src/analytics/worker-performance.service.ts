import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BOOKING_CLOCK, BOOKING_TIMEZONE } from './booking-analytics.service';
import { WorkerPerformanceQueryDto } from './worker-performance-query.dto';
import { WORKER_PERFORMANCE_SQL } from './worker-performance.sql';

export interface WorkerPerformanceRow {
  period_start: Date;
  period_end: Date;
  queried_at: Date;
  source_updated_at: Date | null;
  workers: {
    workerId: string;
    fullName: string;
    role: string;
    isActive: boolean;
    completedCount: string;
    validDurationCount: string;
    averageMinutes: string | null;
    openComplaintCount: string;
    negativeDurationCount: string;
    missingCompletionCount: string;
    unexpectedCompletionCount: string;
  }[];
}

function count(raw: string) {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value))
    throw new Error('Invalid count');
  return value;
}

@Injectable()
export class WorkerPerformanceService {
  constructor(
    private readonly database: DataSource,
    @Inject(BOOKING_CLOCK) private readonly now: () => Date,
  ) {}

  async summary(query: WorkerPerformanceQueryDto, exportLimit?: number) {
    try {
      const asOf = this.now().toISOString();
      const [row] = await this.database.query<WorkerPerformanceRow[]>(
        exportLimit === undefined
          ? WORKER_PERFORMANCE_SQL
          : WORKER_PERFORMANCE_SQL.replace(
              '), completions AS (',
              'ORDER BY worker_id LIMIT $5\n), completions AS (',
            ),
        [
          query.period,
          BOOKING_TIMEZONE,
          asOf,
          query.workerId ?? null,
          ...(exportLimit === undefined ? [] : [exportLimit]),
        ],
      );
      if (!row || !Array.isArray(row.workers))
        throw new Error('Missing report');
      const workers = row.workers.map((w) => {
        const completedCount = count(w.completedCount),
          validDurationCount = count(w.validDurationCount);
        const average =
          w.averageMinutes === null ? null : Number(w.averageMinutes);
        if (
          validDurationCount > completedCount ||
          (validDurationCount === 0
            ? average !== null
            : average === null ||
              !Number.isFinite(average) ||
              average < 0 ||
              average > Number.MAX_SAFE_INTEGER / 100)
        )
          throw new Error('Invalid duration');
        const quality = {
          negativeDurationCount: count(w.negativeDurationCount),
          missingCompletionCount: count(w.missingCompletionCount),
          unexpectedCompletionCount: count(w.unexpectedCompletionCount),
        };
        return {
          workerId: w.workerId,
          fullName: w.fullName,
          role: w.role,
          isActive: w.isActive,
          completedTaskCount: completedCount,
          validDurationCount,
          excludedDurationCount: completedCount - validDurationCount,
          averageCompletionMinutes:
            average === null ? null : Math.round(average * 100) / 100,
          openComplaintCount: count(w.openComplaintCount),
          dataQuality: {
            status: Object.values(quality).some((v) => v > 0)
              ? 'WARNING'
              : 'OK',
            ...quality,
          },
        };
      });
      return {
        period: query.period,
        timezone: BOOKING_TIMEZONE,
        weekStartsOn: 'monday',
        asOf,
        start: row.period_start.toISOString(),
        end: row.period_end.toISOString(),
        workerScope:
          'current_worker_role_or_historical_task_assignee_including_inactive',
        completionCohort: 'completed_at_in_period_and_current_status_completed',
        durationStart: 'submitted_at',
        durationUnit: 'minutes',
        complaintCohort:
          'currently_open_submitted_on_or_before_as_of_all_dates',
        openComplaintStatuses: ['SUBMITTED', 'UNDER_REVIEW'],
        dataQualityScope: 'all_tasks_assigned_to_each_returned_worker',
        workers,
        freshness: {
          queriedAt: row.queried_at.toISOString(),
          sourceLatestUpdatedAt: row.source_updated_at?.toISOString() ?? null,
        },
      };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
