import { z } from 'zod';
import { AnalyticsError } from './analytics';

export const monthSchema = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/);
export function monthDates(month: string): string[] {
  monthSchema.parse(month);
  const [year, number] = month.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const count = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    number - 1
  ];
  return Array.from(
    { length: count },
    (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`,
  );
}
export function shiftMonth(month: string, offset: number): string | null {
  monthSchema.parse(month);
  const [year, number] = month.split('-').map(Number);
  const index = year * 12 + number - 1 + offset;
  const nextYear = Math.floor(index / 12);
  return nextYear < 1 || nextYear > 9999
    ? null
    : `${String(nextYear).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}
export function hotelMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  return `${parts.find((part) => part.type === 'year')!.value}-${parts.find((part) => part.type === 'month')!.value}`;
}
// UTC is used only to calculate weekday placement, never to reinterpret API dates.
export function leadingDays(month: string) {
  monthSchema.parse(month);
  return (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;
}
export const occupancyDaySchema = z
  .object({
    date: z.iso.date(),
    occupiedRooms: z.number().int().nonnegative().safe(),
    eligibleRooms: z.number().int().nonnegative().safe(),
    rate: z.number().min(0).max(1).nullable(),
  })
  .refine(
    (day) =>
      day.occupiedRooms <= day.eligibleRooms &&
      (day.eligibleRooms === 0
        ? day.rate === null
        : day.rate !== null &&
          Math.abs(day.rate - day.occupiedRooms / day.eligibleRooms) < 1e-9),
  );
export const occupancySchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  timezone: z.literal('Asia/Colombo'),
  rangeEndInclusive: z.literal(true),
  maxRangeDays: z.literal(366),
  includedStatuses: z.array(z.enum(['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'])),
  denominator: z.literal('active_rooms_excluding_maintenance'),
  dates: z.array(occupancyDaySchema).max(31),
  freshness: z.object({
    queriedAt: z.iso.datetime(),
    sourceLatestUpdatedAt: z.iso.datetime().nullable(),
  }),
});
export type Occupancy = z.infer<typeof occupancySchema>;
export type OccupancyDay = z.infer<typeof occupancyDaySchema>;
export function parseOccupancy(value: unknown, month: string): Occupancy {
  const data = occupancySchema.parse(value);
  const dates = monthDates(month);
  if (
    data.from !== dates[0] ||
    data.to !== dates.at(-1) ||
    (data.dates.length !== 0 &&
      (data.dates.length !== dates.length ||
        data.dates.some((day, index) => day.date !== dates[index])))
  ) {
    throw new Error('Mismatched occupancy month');
  }
  return data;
}
// Display bands only: these do not change the configurable low-booking alert policy.
export function demand(rate: number | null) {
  return rate === null
    ? 'Unknown'
    : rate < 0.4
      ? 'Low'
      : rate < 0.7
        ? 'Medium'
        : 'High';
}
export async function loadOccupancy(month: string, signal: AbortSignal) {
  monthSchema.parse(month);
  const response = await fetch(`/api/analytics/occupancy?month=${month}`, {
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new AnalyticsError(response.status);
  return parseOccupancy(await response.json(), month);
}
