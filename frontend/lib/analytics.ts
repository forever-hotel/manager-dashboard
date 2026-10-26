import { z } from 'zod';

export const periodSchema = z.enum(['day', 'week', 'month']);
export type Period = z.infer<typeof periodSchema>;
export const bookingSchema = z
  .object({
    period: periodSchema,
    timezone: z.literal('Asia/Colombo'),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    asOf: z.iso.datetime(),
    total: z.number().int().nonnegative().safe(),
    trend: z
      .array(
        z.object({
          date: z.iso.date(),
          start: z.iso.datetime(),
          end: z.iso.datetime(),
          count: z.number().int().nonnegative().safe()
        })
      )
      .max(31)
  })
  .refine(data => data.total === data.trend.reduce((sum, bucket) => sum + bucket.count, 0));
export type BookingSummary = z.infer<typeof bookingSchema>;
export class AnalyticsError extends Error {
  constructor(public status: number) {
    super('Analytics unavailable');
  }
}
export const revenueSchema = z
  .object({
    period: periodSchema,
    timezone: z.literal('Asia/Colombo'),
    currency: z.literal('LKR'),
    metric: z.literal('completed_payment_revenue'),
    comparison: z.literal('whole_calendar_period'),
    asOf: z.iso.datetime(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    previousStart: z.iso.datetime(),
    previousEnd: z.iso.datetime(),
    currentMinor: z.number().int().nonnegative().safe(),
    previousMinor: z.number().int().nonnegative().safe(),
    percentageChange: z.number().finite().nullable(),
    percentageUnavailableReason: z.literal('PREVIOUS_REVENUE_ZERO').nullable()
  })
  .refine(data =>
    data.previousMinor === 0
      ? data.percentageChange === null && data.percentageUnavailableReason === 'PREVIOUS_REVENUE_ZERO'
      : data.percentageChange !== null && data.percentageUnavailableReason === null
  );
export const overviewSchema = z
  .object({
    bookings: bookingSchema,
    revenue: revenueSchema,
    averageLengthOfStay: z.number().positive().finite().nullable(),
    occupancy: z
      .object({
        rate: z.number().min(0).max(1).nullable(),
        occupiedRoomNights: z.number().int().nonnegative().safe(),
        eligibleRoomNights: z.number().int().nonnegative().safe(),
        roomsUsingCreationDate: z.number().int().nonnegative().safe()
      })
      .refine(
        value =>
          value.occupiedRoomNights <= value.eligibleRoomNights &&
          (value.eligibleRoomNights === 0
            ? value.rate === null
            : value.rate !== null && Math.abs(value.rate - value.occupiedRoomNights / value.eligibleRoomNights) < 1e-9)
      ),
    recentBookings: z
      .array(
        z.object({
          id: z.uuid(),
          guestName: z.string().nullable(),
          roomType: z.string(),
          checkIn: z.iso.date(),
          checkOut: z.iso.date(),
          amountMinor: z.number().int().nonnegative().safe(),
          source: z.string(),
          status: z.string()
        })
      )
      .max(5)
  })
  .refine(
    ({ bookings, revenue }) =>
      bookings.period === revenue.period &&
      bookings.start === revenue.start &&
      bookings.end === revenue.end &&
      bookings.asOf === revenue.asOf
  );
export type Overview = z.infer<typeof overviewSchema>;
export async function loadAnalytics(period: Period, signal: AbortSignal): Promise<Overview> {
  const response = await fetch('/api/analytics?period=' + period, {
    signal,
    cache: 'no-store',
    credentials: 'same-origin'
  });
  if (!response.ok) throw new AnalyticsError(response.status);
  const data = overviewSchema.parse(await response.json());
  if (data.bookings.period !== period) throw new Error('Mismatched analytics period');
  return data;
}
export function money(minor: number) {
  // Keep cents exact even at the upper end of safe integer API amounts.
  const amount = BigInt(minor);
  const whole = new Intl.NumberFormat('en-LK').format(amount / BigInt(100));
  const cents = String(amount % BigInt(100)).padStart(2, '0');
  return `LKR ${whole}.${cents}`;
}
export function percentage(value: number | null) {
  return value === null ? 'N/A' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}
