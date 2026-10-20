import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BOOKING_CLOCK, BOOKING_TIMEZONE } from './booking-analytics.service';
import { BookingPeriod } from './booking-query.dto';
import { SERVICE_REQUESTS_SQL } from './service-requests.sql';
export const REQUEST_STATUSES = [
  'SUBMITTED',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
];
export interface ServiceRequestSummaryRow {
  period_start: Date;
  period_end: Date;
  total: string;
  completed_count: string;
  valid_duration_count: string;
  average_minutes: string | null;
  unresolved_count: string;
  negative_duration_count: string;
  missing_completion_count: string;
  unexpected_completion_count: string;
  statuses: { status: string; count: string }[];
  trend: { date: string; count: string }[];
  source_updated_at: Date | null;
  queried_at: Date;
}
function count(raw: string) {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value))
    throw new Error('Invalid count');
  return value;
}
@Injectable()
export class ServiceRequestAnalyticsService {
  constructor(
    private readonly database: DataSource,
    @Inject(BOOKING_CLOCK) private readonly now: () => Date,
  ) {}
  async summary(period: BookingPeriod) {
    try {
      const asOf = this.now().toISOString();
      const [row] = await this.database.query<ServiceRequestSummaryRow[]>(
        SERVICE_REQUESTS_SQL,
        [period, BOOKING_TIMEZONE, asOf],
      );
      if (!row || !row.trend.length || row.statuses.length !== 4)
        throw new Error('Missing buckets');
      const total = count(row.total),
        completedCount = count(row.completed_count),
        validDurationCount = count(row.valid_duration_count);
      const trend = row.trend.map((b) => ({
        date: b.date,
        count: count(b.count),
      }));
      const byStatus = row.statuses.map((b, i) => {
        if (b.status !== REQUEST_STATUSES[i]) throw new Error('Unknown state');
        return { status: b.status, count: count(b.count) };
      });
      if (
        trend.reduce((n, b) => n + b.count, 0) !== total ||
        byStatus.reduce((n, b) => n + b.count, 0) !== total ||
        validDurationCount > completedCount
      )
        throw new Error('Inconsistent totals');
      const average =
        row.average_minutes === null ? null : Number(row.average_minutes);
      if (
        validDurationCount === 0
          ? average !== null
          : average === null ||
            !Number.isFinite(average) ||
            average < 0 ||
            average > Number.MAX_SAFE_INTEGER
      )
        throw new Error('Invalid duration');
      const quality = {
        negativeDurationCount: count(row.negative_duration_count),
        missingCompletionCount: count(row.missing_completion_count),
        unexpectedCompletionCount: count(row.unexpected_completion_count),
      };
      return {
        period,
        timezone: BOOKING_TIMEZONE,
        weekStartsOn: 'monday',
        asOf,
        start: row.period_start.toISOString(),
        end: row.period_end.toISOString(),
        total,
        createdCohort: 'submitted_at_in_period',
        trend,
        byStatus,
        resolution: {
          cohort: 'completed_at_in_period_and_current_status_completed',
          unit: 'minutes',
          completedCount,
          validDurationCount,
          excludedCount: completedCount - validDurationCount,
          averageMinutes:
            average === null ? null : Math.round(average * 100) / 100,
        },
        backlog: {
          cohort: 'current_unresolved_submitted_on_or_before_as_of_all_dates',
          statuses: REQUEST_STATUSES.slice(0, 3),
          count: count(row.unresolved_count),
        },
        dataQuality: {
          scope: 'all_source_records',
          status: Object.values(quality).some((v) => v > 0) ? 'WARNING' : 'OK',
          ...quality,
        },
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
