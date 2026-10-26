import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BOOKING_CLOCK, BOOKING_TIMEZONE } from './booking-analytics.service';
import { BookingPeriod } from './booking-query.dto';
import { FOOD_ORDERS_SQL } from './food-orders.sql';

export const INCLUDED_FOOD_STATUSES = ['PLACED', 'IN_PREPARATION', 'READY', 'DELIVERED'];
export interface FoodSummaryRow {
  period_start: Date;
  period_end: Date;
  total: string;
  trend: { date: string; count: string }[];
  hours: { hour: number; count: string }[];
  items: { id: string; name: string; quantity: string }[];
  source_updated_at: Date | null;
  queried_at: Date;
  delivered_count: string;
  valid_duration_count: string;
  invalid_duration_count: string;
  average_delivery_minutes: number | null;
  sales_minor: string;
  invalid_amount_count: string;
}
function count(value: string) {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) throw new Error('Invalid count');
  return parsed;
}
@Injectable()
export class FoodAnalyticsService {
  constructor(
    private readonly database: DataSource,
    @Inject(BOOKING_CLOCK) private readonly now: () => Date
  ) {}
  async summary(period: BookingPeriod, date?: string) {
    try {
      const asOf = this.now().toISOString();
      const [row] = await this.database.query<FoodSummaryRow[]>(FOOD_ORDERS_SQL, [
        period,
        BOOKING_TIMEZONE,
        date ? `${date}T12:00:00.000Z` : asOf,
        INCLUDED_FOOD_STATUSES
      ]);
      if (!row || !row.trend.length || row.hours.length !== 24) throw new Error('Missing buckets');
      const total = count(row.total);
      const trend = row.trend.map(bucket => ({
        date: bucket.date,
        count: count(bucket.count)
      }));
      const hours = row.hours.map((bucket, index) => {
        if (bucket.hour !== index) throw new Error('Invalid hour bucket');
        return { hour: bucket.hour, count: count(bucket.count) };
      });
      if (trend.reduce((n, b) => n + b.count, 0) !== total || hours.reduce((n, b) => n + b.count, 0) !== total)
        throw new Error('Inconsistent totals');
      const peak = Math.max(...hours.map(b => b.count));
      const deliveredCount = count(row.delivered_count),
        validDurationCount = count(row.valid_duration_count),
        excludedDurationCount = count(row.invalid_duration_count);
      if (
        count(row.invalid_amount_count) !== 0 ||
        validDurationCount + excludedDurationCount !== deliveredCount ||
        (validDurationCount === 0
          ? row.average_delivery_minutes !== null
          : row.average_delivery_minutes === null ||
            !Number.isFinite(row.average_delivery_minutes) ||
            row.average_delivery_minutes < 0)
      )
        throw new Error('Invalid delivered-order metrics');
      return {
        period,
        timezone: BOOKING_TIMEZONE,
        weekStartsOn: 'monday',
        metric: 'non_cancelled_food_orders_placed',
        includedStatuses: [...INCLUDED_FOOD_STATUSES],
        start: row.period_start.toISOString(),
        end: row.period_end.toISOString(),
        asOf,
        total,
        delivery: {
          averageMinutes: row.average_delivery_minutes,
          deliveredCount,
          validDurationCount,
          excludedDurationCount,
          cohort: 'delivered_at_in_period',
          durationStart: 'placed_at'
        },
        revenue: {
          amountMinor: count(row.sales_minor),
          currency: 'LKR',
          metric: 'delivered_order_sales',
          recognition: 'delivered_at',
          orderCount: deliveredCount
        },
        trend,
        hours,
        peakHours: peak ? hours.filter(b => b.count === peak).map(b => b.hour) : [],
        popularItems: row.items.map(item => ({
          menuItemId: item.id,
          name: item.name,
          quantity: count(item.quantity)
        })),
        itemLimit: 10,
        itemGrouping: 'menu_item_id_and_historical_name',
        freshness: {
          queriedAt: row.queried_at.toISOString(),
          sourceLatestUpdatedAt: row.source_updated_at?.toISOString() ?? null
        }
      };
    } catch {
      throw new ServiceUnavailableException();
    }
  }
}
