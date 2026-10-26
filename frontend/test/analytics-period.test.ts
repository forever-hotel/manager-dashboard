import { describe, it, expect } from 'vitest';
import { hotelDate, shiftAnalyticsDate } from '@/lib/analytics-period';
describe('Hotel analytics periods', () => {
  it('uses Colombo dates across the UTC day boundary', () => {
    expect(hotelDate(new Date('2026-10-25T19:00:00Z'))).toBe('2026-10-26');
  });
  it('navigates months without overflowing long-month dates', () => {
    expect(shiftAnalyticsDate('2026-03-31', 'month', -1)).toBe('2026-02-01');
    expect(shiftAnalyticsDate('2026-01-31', 'month', -1)).toBe('2025-12-01');
  });
  it('navigates leap days and week boundaries', () => {
    expect(shiftAnalyticsDate('2024-03-01', 'day', -1)).toBe('2024-02-29');
    expect(shiftAnalyticsDate('2026-01-03', 'week', -1)).toBe('2025-12-27');
    expect(shiftAnalyticsDate('0001-01-01', 'day', -1)).toBeNull();
  });
});
