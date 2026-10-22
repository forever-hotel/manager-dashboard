import { z } from 'zod';
import { occupancyDaySchema } from './occupancy';
import { AnalyticsError } from './analytics';

export const lowDemandSchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    timezone: z.literal('Asia/Colombo'),
    rangeEndInclusive: z.literal(true),
    threshold: z.number().min(0).max(1),
    denominator: z.literal('active_rooms_excluding_maintenance'),
    includedStatuses: z.array(
      z.enum(['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT']),
    ),
    alerts: z
      .array(
        occupancyDaySchema.and(z.object({ promotionSuggestion: z.string() })),
      )
      .max(14),
    unavailableDates: z
      .array(
        occupancyDaySchema.and(
          z.object({ reason: z.literal('ZERO_ELIGIBLE_ROOMS') }),
        ),
      )
      .max(14),
    freshness: z.object({
      queriedAt: z.iso.datetime(),
      sourceLatestUpdatedAt: z.iso.datetime().nullable(),
    }),
  })
  .superRefine((data, ctx) => {
    const days = [...data.alerts, ...data.unavailableDates];
    if (
      Date.parse(data.to) - Date.parse(data.from) !== 13 * 86400000 ||
      new Set(days.map((day) => day.date)).size !== days.length ||
      days.some((day) => day.date < data.from || day.date > data.to) ||
      data.alerts.some(
        (day) => day.rate === null || day.rate >= data.threshold,
      ) ||
      data.unavailableDates.some((day) => day.rate !== null)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid low-demand range or occupancy data',
      });
  });
export type LowDemand = z.infer<typeof lowDemandSchema>;
export async function loadLowDemand(signal: AbortSignal) {
  const response = await fetch('/api/analytics/low-booking-alerts', {
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new AnalyticsError(response.status);
  return lowDemandSchema.parse(await response.json());
}
export function promotionDates(value: unknown) {
  const parsed = z.iso.date().safeParse(value);
  if (!parsed.success || parsed.data.startsWith('0000')) return undefined;
  const next = new Date(Date.parse(parsed.data) + 86400000).toISOString();
  if (next.length !== 24) return undefined;
  return {
    validFrom: parsed.data + 'T00:00',
    validUntil: next.slice(0, 10) + 'T00:00',
  };
}
