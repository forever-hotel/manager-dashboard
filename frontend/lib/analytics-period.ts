import type { Period } from './analytics';
export function hotelDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)!.value).join('-');
}
export function shiftAnalyticsDate(date: string, period: Period, step: number): string | null {
  const value = new Date(date + 'T12:00:00Z');
  if (period === 'month') {
    value.setUTCDate(1);
    value.setUTCMonth(value.getUTCMonth() + step);
  } else value.setUTCDate(value.getUTCDate() + step * (period === 'week' ? 7 : 1));
  if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1 || value.getUTCFullYear() > 9999) return null;
  return value.toISOString().slice(0, 10);
}
