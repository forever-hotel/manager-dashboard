import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BookingPeriod } from './booking-query.dto';
import { BOOKINGS_SQL } from './bookings.sql';

export const BOOKING_CLOCK = Symbol('BOOKING_CLOCK');
export const BOOKING_TIMEZONE = 'Asia/Colombo';
export const INCLUDED_BOOKING_STATUSES = [
  'CONFIRMED',
  'CHECKED_IN',
  'CHECKED_OUT',
];

interface BookingBucketRow {
  period_start: Date;
  period_end: Date;
  bucket_start: Date;
  bucket_end: Date;
  bucket_date: string;
  count: string;
  source_updated_at: Date | null;
  queried_at: Date;
}

@Injectable()
export class BookingAnalyticsService {
  constructor(
    private readonly database: DataSource,
    @Inject(BOOKING_CLOCK) private readonly now: () => Date,
  ) {}

  async summary(period: BookingPeriod) {
    try {
      const asOf = this.now().toISOString();
      const rows = await this.database.query<BookingBucketRow[]>(BOOKINGS_SQL, [
        period,
        BOOKING_TIMEZONE,
        asOf,
        INCLUDED_BOOKING_STATUSES,
      ]);
      if (!rows.length) throw new Error('Missing calendar buckets');
      const first = rows[0];
      const trend = rows.map((row) => {
        const count = Number(row.count);
        if (!Number.isSafeInteger(count) || count < 0)
          throw new Error('Invalid booking count');
        return {
          date: row.bucket_date,
          start: row.bucket_start.toISOString(),
          end: row.bucket_end.toISOString(),
          count,
        };
      });
      const total = trend.reduce((sum, bucket) => sum + bucket.count, 0);
      if (!Number.isSafeInteger(total))
        throw new Error('Invalid booking total');
      return {
        period,
        timezone: BOOKING_TIMEZONE,
        weekStartsOn: 'monday',
        metric: 'bookings_checking_in',
        includedStatuses: [...INCLUDED_BOOKING_STATUSES],
        start: first.period_start.toISOString(),
        end: first.period_end.toISOString(),
        asOf,
        bucketSize: 'day',
        total,
        trend,
        freshness: {
          queriedAt: first.queried_at.toISOString(),
          sourceLatestUpdatedAt: first.source_updated_at?.toISOString() ?? null,
        },
      };
    } catch {
      // A missing view, denied grant or database outage is not an empty period.
      throw new ServiceUnavailableException();
    }
  }
}
