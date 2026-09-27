import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { validate } from 'class-validator';
import { BookingAnalyticsService } from './booking-analytics.service';
import { BookingQueryDto } from './booking-query.dto';

describe('DDP-009 booking summaries', () => {
  const clock = new Date('2026-09-27T04:00:00Z');
  const row = {
    period_start: new Date('2026-09-26T18:30:00Z'),
    period_end: new Date('2026-09-27T18:30:00Z'),
    bucket_start: new Date('2026-09-26T18:30:00Z'),
    bucket_end: new Date('2026-09-27T18:30:00Z'),
    bucket_date: '2026-09-27',
    count: '2',
    source_updated_at: new Date('2026-09-27T03:00:00Z'),
    queried_at: clock,
  };
  let query: jest.Mock;
  let service: BookingAnalyticsService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([row]);
    service = new BookingAnalyticsService(
      { query } as unknown as DataSource,
      () => clock,
    );
  });

  it('returns explicit check-in semantics, UTC boundaries and freshness', async () => {
    const result = await service.summary('day');
    expect(result).toMatchObject({
      metric: 'bookings_checking_in',
      timezone: 'Asia/Colombo',
      weekStartsOn: 'monday',
      bucketSize: 'day',
      start: '2026-09-26T18:30:00.000Z',
      end: '2026-09-27T18:30:00.000Z',
      asOf: clock.toISOString(),
      total: 2,
      freshness: {
        queriedAt: clock.toISOString(),
        sourceLatestUpdatedAt: '2026-09-27T03:00:00.000Z',
      },
    });
    expect(result.trend[0]).toMatchObject({ date: '2026-09-27', count: 2 });
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'day',
      'Asia/Colombo',
      clock.toISOString(),
      ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'],
    ]);
  });

  it('keeps an empty source distinct from a source failure', async () => {
    query.mockResolvedValue([{ ...row, count: '0', source_updated_at: null }]);
    const result = await service.summary('day');
    expect(result.total).toBe(0);
    expect(result.trend[0].count).toBe(0);
    expect(result.freshness.sourceLatestUpdatedAt).toBeNull();
    query.mockRejectedValue(new Error('private connection details'));
    await expect(service.summary('day')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it.each(['-1', '1.5', 'NaN', 'Infinity', '9007199254740992'])(
    'refuses invalid or imprecise count %s',
    async (count) => {
      query.mockResolvedValue([{ ...row, count }]);
      await expect(service.summary('day')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    },
  );

  it('refuses a total that cannot be represented accurately', async () => {
    query.mockResolvedValue([
      { ...row, count: String(Number.MAX_SAFE_INTEGER) },
      row,
    ]);
    await expect(service.summary('week')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('does not report success if the database returns no calendar rows', async () => {
    query.mockResolvedValue([]);
    await expect(service.summary('month')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it.each(['day', 'week', 'month'])('accepts period %s', async (period) => {
    expect(
      await validate(Object.assign(new BookingQueryDto(), { period })),
    ).toHaveLength(0);
  });

  it.each(['year', '', 'DAY', ['day', 'week'], null])(
    'rejects invalid period %s',
    async (period) => {
      expect(
        await validate(Object.assign(new BookingQueryDto(), { period })),
      ).not.toHaveLength(0);
    },
  );

  it('defaults an omitted period to day', () => {
    expect(new BookingQueryDto().period).toBe('day');
  });
});
