import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BOOKING_CLOCK, BOOKING_TIMEZONE } from './booking-analytics.service';
import { BookingPeriod } from './booking-query.dto';
import { SERVICE_REQUESTS_SQL } from './service-requests.sql';
import { isISO8601, isUUID } from 'class-validator';
import { ServiceRequestListQueryDto } from './service-request-query.dto';
import { SERVICE_REQUEST_LIST_SQL } from './service-request-list.sql';

export interface ServiceRequestItem {
  id: string;
  roomNumber: string;
  category: string;
  status: string;
  submittedAt: string;
  assignee: string | null;
}
export const REQUEST_STATUSES = ['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];
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

  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value)) throw new Error('Invalid count');
  return value;
}

@Injectable()
export class ServiceRequestAnalyticsService {
  constructor(
    private readonly database: DataSource,
    @Inject(BOOKING_CLOCK) private readonly now: () => Date
  ) {}

  async summary(period: BookingPeriod, date?: string) {
    try {
      const asOf = this.now().toISOString();
      const [row] = await this.database.query<ServiceRequestSummaryRow[]>(SERVICE_REQUESTS_SQL, [
        period,
        BOOKING_TIMEZONE,
        date ? `${date}T12:00:00.000Z` : asOf,
        asOf
      ]);

      if (!row || !row.trend.length || row.statuses.length !== 4) throw new Error('Missing buckets');
      const total = count(row.total),
        completedCount = count(row.completed_count),
        validDurationCount = count(row.valid_duration_count);
      const trend = row.trend.map(b => ({
        date: b.date,
        count: count(b.count)
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
      const average = row.average_minutes === null ? null : Number(row.average_minutes);

      if (
        validDurationCount === 0
          ? average !== null
          : average === null || !Number.isFinite(average) || average < 0 || average > Number.MAX_SAFE_INTEGER
      )
        throw new Error('Invalid duration');
      const quality = {
        negativeDurationCount: count(row.negative_duration_count),
        missingCompletionCount: count(row.missing_completion_count),
        unexpectedCompletionCount: count(row.unexpected_completion_count)
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
          averageMinutes: average === null ? null : Math.round(average * 100) / 100
        },
        backlog: {
          cohort: 'current_unresolved_submitted_on_or_before_as_of_all_dates',
          statuses: REQUEST_STATUSES.slice(0, 3),
          count: count(row.unresolved_count)
        },
        dataQuality: {
          scope: 'all_source_records',
          status: Object.values(quality).some(v => v > 0) ? 'WARNING' : 'OK',
          ...quality
        },
        freshness: {
          queriedAt: row.queried_at.toISOString(),
          sourceLatestUpdatedAt: row.source_updated_at?.toISOString() ?? null
        }
      };
    } catch {
      throw new ServiceUnavailableException();
    }
  }

  async list(query: ServiceRequestListQueryDto) {
    try {
      const now = this.now().toISOString();
      const [row] = await this.database.query<{ total: string; requests: ServiceRequestItem[] }[]>(
        SERVICE_REQUEST_LIST_SQL,
        [
          query.period,
          BOOKING_TIMEZONE,
          query.date ? `${query.date}T12:00:00.000Z` : now,
          query.view,
          query.pageSize,
          (query.page - 1) * query.pageSize
        ]
      );

      if (!row || !Array.isArray(row.requests)) throw new Error('Missing list');
      const total = count(row.total);

      if (row.requests.length !== Math.min(query.pageSize, Math.max(0, total - (query.page - 1) * query.pageSize)))
        throw new Error('Invalid page');
      const seen = new Set<string>();

      for (const item of row.requests) {
        if (
          !item ||
          !isUUID(item.id) ||
          seen.has(item.id) ||
          typeof item.roomNumber !== 'string' ||
          !item.roomNumber.trim() ||
          item.roomNumber.length > 10 ||
          typeof item.category !== 'string' ||
          !item.category.trim() ||
          item.category.length > 100 ||
          !REQUEST_STATUSES.includes(item.status) ||
          (query.view === 'active' && item.status === 'COMPLETED') ||
          typeof item.submittedAt !== 'string' ||
          !isISO8601(item.submittedAt, { strict: true }) ||
          (item.assignee !== null &&
            (typeof item.assignee !== 'string' || !item.assignee.trim() || item.assignee.length > 255))
        )
          throw new Error('Invalid request');
        seen.add(item.id);
      }
      return { requests: row.requests, total, page: query.page, pageSize: query.pageSize, view: query.view };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
