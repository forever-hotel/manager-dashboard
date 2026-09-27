import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { DataSource } from 'typeorm';
import { OccupancyAnalyticsService } from './occupancy-analytics.service';
import { OccupancyQueryDto } from './occupancy-query.dto';

describe('DDP-010 occupancy calendar', () => {
  const range = { from: '2026-09-27', to: '2026-09-27' };
  const row = {
    date: range.from,
    eligible_rooms: '4',
    occupied_rooms: '1',
    queried_at: new Date('2026-09-27T04:00:00Z'),
    source_updated_at: new Date('2026-09-26T12:00:00Z'),
  };
  let query: jest.Mock;
  let service: OccupancyAnalyticsService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([row]);
    service = new OccupancyAnalyticsService({ query } as unknown as DataSource);
  });

  it('given eligible occupied rooms, returns a fractional rate and explicit policy', async () => {
    expect(await service.calendar(range)).toMatchObject({
      ...range,
      timezone: 'Asia/Colombo',
      rangeEndInclusive: true,
      denominator: 'active_rooms_excluding_maintenance',
      maxRangeDays: 366,
      dates: [
        { date: range.from, eligibleRooms: 4, occupiedRooms: 1, rate: 0.25 },
      ],
      freshness: { sourceLatestUpdatedAt: row.source_updated_at.toISOString() },
    });
  });

  it('given zero capacity, returns a null rate and null source freshness', async () => {
    query.mockResolvedValue([
      {
        ...row,
        eligible_rooms: '0',
        occupied_rooms: '0',
        source_updated_at: null,
      },
    ]);
    expect(await service.calendar(range)).toMatchObject({
      dates: [{ eligibleRooms: 0, occupiedRooms: 0, rate: null }],
      freshness: { sourceLatestUpdatedAt: null },
    });
  });

  it.each([
    { from: '2026-09-28', to: '2026-09-27' },
    { from: '2024-01-01', to: '2025-01-01' },
    { from: 'invalid', to: '2026-09-27' },
  ])(
    'given a reversed, oversized or invalid range %j, rejects before reading',
    async (input) => {
      await expect(service.calendar(input)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(query).not.toHaveBeenCalled();
    },
  );

  it('given the maximum leap-year range, returns all 366 dates', async () => {
    query.mockResolvedValue(
      Array.from({ length: 366 }, (_, i) => ({
        ...row,
        date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10),
      })),
    );
    expect(
      (await service.calendar({ from: '2024-01-01', to: '2024-12-31' })).dates,
    ).toHaveLength(366);
  });

  it.each([
    { eligible_rooms: '-1' },
    { eligible_rooms: '1.5' },
    { eligible_rooms: '9007199254740992' },
    { occupied_rooms: '-1' },
    { occupied_rooms: 'NaN' },
    { occupied_rooms: '5' },
    { date: '2026-09-28' },
  ])(
    'given invalid source counts or dates %j, fails closed',
    async (invalid) => {
      query.mockResolvedValue([{ ...row, ...invalid }]);
      await expect(service.calendar(range)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    },
  );

  it('given an incomplete calendar or source outage, does not return zero occupancy', async () => {
    query.mockResolvedValue([]);
    await expect(service.calendar(range)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    query.mockRejectedValue(new Error('private database detail'));
    await expect(service.calendar(range)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it.each(['2024-02-29', '2026-12-31', '0001-01-01'])(
    'given a real date %s, accepts the DTO',
    async (date) => {
      expect(
        await validate(
          Object.assign(new OccupancyQueryDto(), { from: date, to: date }),
        ),
      ).toHaveLength(0);
    },
  );

  it.each([
    '2025-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-9-01',
    '0000-01-01',
    '2026-09-27T00:00:00Z',
    '',
    null,
    undefined,
    ['2026-09-27'],
  ])('given a missing or malformed date %j, rejects the DTO', async (date) => {
    expect(
      await validate(
        Object.assign(new OccupancyQueryDto(), { from: date, to: date }),
      ),
    ).not.toHaveLength(0);
  });
});
