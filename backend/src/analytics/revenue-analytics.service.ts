import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BOOKING_CLOCK, BOOKING_TIMEZONE } from './booking-analytics.service';
import { BookingPeriod } from './booking-query.dto';

export const REVENUE_SQL = `
WITH calendar AS (
 SELECT date_trunc($1, $3::timestamptz AT TIME ZONE $2) AS local_start,
 CASE $1 WHEN 'day' THEN interval '1 day' WHEN 'week' THEN interval '1 week' ELSE interval '1 month' END AS step
), bounds AS (
 SELECT local_start AT TIME ZONE $2 AS start,
 (local_start + step) AT TIME ZONE $2 AS finish,
 (local_start - step) AT TIME ZONE $2 AS previous_start FROM calendar
), totals AS (
 SELECT COALESCE(sum(amount) FILTER (WHERE paid_at >= start AND paid_at < finish),0)::numeric AS current,
 COALESCE(sum(amount) FILTER (WHERE paid_at >= previous_start AND paid_at < start),0)::numeric AS previous,
 count(*) FILTER (WHERE payment_id IS NOT NULL AND (paid_at IS NULL OR amount IS NULL OR amount <= 0)) AS invalid
 FROM bounds LEFT JOIN public.payments ON payment_status='COMPLETED'
 AND (paid_at IS NULL OR (paid_at >= previous_start AND paid_at < finish))
)
SELECT start,finish,previous_start,current::text,previous::text,
 CASE WHEN previous=0 THEN NULL ELSE round((current-previous)*100/previous,2)::text END AS percentage,
 invalid::text FROM bounds CROSS JOIN totals
`;
@Injectable()
export class RevenueAnalyticsService {
  constructor(
    private readonly database: DataSource,
    @Inject(BOOKING_CLOCK) private readonly now: () => Date
  ) {}
  async summary(period: BookingPeriod, asOf?: string, date?: string) {
    try {
      asOf ??= this.now().toISOString();
      const rows = await this.database.query<
        {
          start: Date;
          finish: Date;
          previous_start: Date;
          current: string;
          previous: string;
          percentage: string | null;
          invalid: string;
        }[]
      >(REVENUE_SQL, [period, BOOKING_TIMEZONE, date ? `${date}T12:00:00.000Z` : asOf]);
      const row = rows[0];
      if (rows.length !== 1 || !row || row.invalid !== '0' || !/^\d+$/.test(row.current) || !/^\d+$/.test(row.previous))
        throw new Error('Invalid payment data');
      const current = Number(row.current),
        previous = Number(row.previous);
      const percentage = row.percentage === null ? null : Number(row.percentage);
      if (
        ![current, previous].every(value => Number.isSafeInteger(value) && value >= 0) ||
        (previous === 0
          ? row.percentage !== null
          : row.percentage === null || !/^-?\d+(\.\d{1,2})?$/.test(row.percentage) || !Number.isFinite(percentage))
      )
        throw new Error('Invalid aggregate');
      return {
        period,
        timezone: BOOKING_TIMEZONE,
        currency: 'LKR',
        metric: 'completed_payment_revenue',
        comparison: 'whole_calendar_period',
        asOf,
        start: row.start.toISOString(),
        end: row.finish.toISOString(),
        previousStart: row.previous_start.toISOString(),
        previousEnd: row.start.toISOString(),
        currentMinor: current,
        previousMinor: previous,
        percentageChange: percentage,
        percentageUnavailableReason: previous === 0 ? 'PREVIOUS_REVENUE_ZERO' : null
      };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
