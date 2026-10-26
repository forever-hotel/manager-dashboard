import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { BookingPeriod } from '../analytics/booking-query.dto';
import { isCalendarDate } from '../analytics/occupancy-query.dto';
export const REPORT_TYPES = [
  'bookings',
  'revenue',
  'worker-performance',
  'staff',
  'food-orders',
  'service-requests',
  'occupancy',
  'low-booking-alerts'
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export interface ReportQuery {
  format: 'csv' | 'pdf';
  period: BookingPeriod;
  workerId?: string;
  from?: string;
  to?: string;
  date?: string;
}
export function parseReportQuery(type: string, raw: Record<string, unknown>): ReportQuery {
  const fail = () => {
    throw new BadRequestException('Use a supported report type, format and its documented filters.');
  };
  if (!REPORT_TYPES.includes(type as ReportType)) return fail();
  const allowed = [
    'format',
    ...(['bookings', 'revenue', 'food-orders', 'service-requests'].includes(type) ? ['date'] : []),
    ...(type === 'occupancy' ? ['from', 'to'] : type === 'low-booking-alerts' ? [] : ['period']),
    ...(['staff', 'worker-performance'].includes(type) ? ['workerId'] : [])
  ];
  if (Object.keys(raw).some(key => !allowed.includes(key) || typeof raw[key] !== 'string')) return fail();
  if (raw.format !== 'csv' && raw.format !== 'pdf') return fail();
  const period = raw.period ?? 'day';
  if (!['day', 'week', 'month'].includes(period as string)) return fail();
  if (raw.workerId !== undefined && (typeof raw.workerId !== 'string' || !isUUID(raw.workerId))) return fail();
  if (raw.date !== undefined && !isCalendarDate(raw.date)) return fail();
  if (
    type === 'occupancy' &&
    (!isCalendarDate(raw.from) ||
      !isCalendarDate(raw.to) ||
      (Date.parse(raw.to) - Date.parse(raw.from)) / 86400000 < 0 ||
      (Date.parse(raw.to) - Date.parse(raw.from)) / 86400000 >= 366)
  )
    return fail();
  return {
    format: raw.format,
    period: period as BookingPeriod,
    workerId: raw.workerId,
    from: raw.from as string | undefined,
    to: raw.to as string | undefined,
    date: raw.date
  };
}
