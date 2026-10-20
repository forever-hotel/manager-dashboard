import { z } from 'zod';
import { periodSchema } from './analytics';
const count = z.number().int().nonnegative().safe();
const duration = z.number().nonnegative().nullable();
const date = z.iso.datetime({ offset: true });
const base = {
  period: periodSchema,
  timezone: z.literal('Asia/Colombo'),
  start: date,
  end: date,
  asOf: date,
};
const trend = z.array(z.object({ date: z.iso.date(), count })).max(31);
const freshness = z.object({
  queriedAt: date,
  sourceLatestUpdatedAt: date.nullable(),
});
const quality = z.object({
  status: z.enum(['OK', 'WARNING']),
  negativeDurationCount: count,
  missingCompletionCount: count,
  unexpectedCompletionCount: count,
});
export const foodSchema = z
  .object({
    ...base,
    total: count,
    trend,
    hours: z
      .array(z.object({ hour: z.number().int().min(0).max(23), count }))
      .length(24),
    peakHours: z.array(z.number().int().min(0).max(23)).max(24),
    popularItems: z
      .array(
        z.object({
          menuItemId: z.uuid(),
          name: z.string().max(255),
          quantity: count,
        }),
      )
      .max(10),
    freshness,
  })
  .refine(
    (s) =>
      s.trend.reduce((n, r) => n + r.count, 0) === s.total &&
      s.hours.reduce((n, r) => n + r.count, 0) === s.total &&
      s.hours.every((r, i) => r.hour === i),
  );
export const serviceSchema = z
  .object({
    ...base,
    total: count,
    trend,
    byStatus: z
      .array(
        z.object({
          status: z.enum(['SUBMITTED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED']),
          count,
        }),
      )
      .length(4),
    resolution: z.object({
      completedCount: count,
      validDurationCount: count,
      excludedCount: count,
      averageMinutes: duration,
      unit: z.literal('minutes'),
      cohort: z.string(),
    }),
    backlog: z.object({
      count,
      cohort: z.string(),
      statuses: z.array(z.string()),
    }),
    dataQuality: quality.extend({ scope: z.string() }),
    freshness,
  })
  .refine(
    (s) =>
      s.trend.reduce((n, r) => n + r.count, 0) === s.total &&
      s.byStatus.reduce((n, r) => n + r.count, 0) === s.total &&
      (s.resolution.validDurationCount === 0) ===
        (s.resolution.averageMinutes === null),
  );
export const workerSchema = z
  .object({
    ...base,
    workers: z
      .array(
        z
          .object({
            workerId: z.uuid(),
            fullName: z.string().max(255),
            role: z.string(),
            isActive: z.boolean(),
            completedTaskCount: count,
            validDurationCount: count,
            excludedDurationCount: count,
            averageCompletionMinutes: duration,
            openComplaintCount: count,
            dataQuality: quality,
          })
          .refine(
            (w) =>
              (w.validDurationCount === 0) ===
              (w.averageCompletionMinutes === null),
          ),
      )
      .max(10000),
    durationUnit: z.literal('minutes'),
    durationStart: z.literal('submitted_at'),
    complaintCohort: z.string(),
    dataQualityScope: z.string(),
    freshness,
  })
  .refine(
    (s) => new Set(s.workers.map((w) => w.workerId)).size === s.workers.length,
  );
export type Worker = z.infer<typeof workerSchema>['workers'][number];
export type SortKey =
  | 'fullName'
  | 'completedTaskCount'
  | 'averageCompletionMinutes'
  | 'openComplaintCount';
export function sortWorkers(
  workers: Worker[],
  key: SortKey,
  descending: boolean,
) {
  return [...workers].sort((a, b) => {
    const x = a[key],
      y = b[key];
    if (x === null && y !== null) return 1;
    if (y === null && x !== null) return -1;
    const result =
      typeof x === 'string' && typeof y === 'string'
        ? x.localeCompare(y)
        : Number(x ?? 0) - Number(y ?? 0);
    return result
      ? descending
        ? -result
        : result
      : a.workerId.localeCompare(b.workerId);
  });
}
export function localBoundary(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
