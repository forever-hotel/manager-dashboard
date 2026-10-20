import { DataSource } from 'typeorm';
import {
  FoodAnalyticsService,
  FoodSummaryRow,
  INCLUDED_FOOD_STATUSES,
} from './food-analytics.service';
import { FoodAnalyticsController } from './food-analytics.controller';
import { FOOD_ORDERS_SQL } from './food-orders.sql';
const now = new Date('2026-10-19T06:00:00Z');
function row(): FoodSummaryRow {
  return {
    period_start: new Date('2026-10-18T18:30:00Z'),
    period_end: new Date('2026-10-19T18:30:00Z'),
    total: '0',
    trend: [{ date: '2026-10-19', count: '0' }],
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, count: '0' })),
    items: [],
    source_updated_at: null,
    queried_at: now,
  };
}
function setup(value = row()) {
  const query = jest.fn().mockResolvedValue([value]);
  return {
    query,
    service: new FoodAnalyticsService(
      { query } as unknown as DataSource,
      () => now,
    ),
  };
}
describe('DDP-023 food analytics', () => {
  it('returns zero-filled empty results and the documented policy', async () => {
    const { service, query } = setup();
    const result = await service.summary('day');
    expect(result).toMatchObject({
      total: 0,
      peakHours: [],
      popularItems: [],
      timezone: 'Asia/Colombo',
      asOf: now.toISOString(),
      freshness: { sourceLatestUpdatedAt: null },
    });
    expect(result.hours).toHaveLength(24);
    expect(result.trend).toEqual([{ date: '2026-10-19', count: 0 }]);
    expect(query).toHaveBeenCalledWith(FOOD_ORDERS_SQL, [
      'day',
      'Asia/Colombo',
      now.toISOString(),
      INCLUDED_FOOD_STATUSES,
    ]);
  });
  it('returns tied peak hours in ascending order and historical item names', async () => {
    const data = row();
    data.total = '4';
    data.trend[0].count = '4';
    data.hours[8].count = '2';
    data.hours[19].count = '2';
    data.items = [{ id: 'item-id', name: 'Historical name', quantity: '9' }];
    data.source_updated_at = now;
    const result = await setup(data).service.summary('week');
    expect(result.peakHours).toEqual([8, 19]);
    expect(result.popularItems).toEqual([
      { menuItemId: 'item-id', name: 'Historical name', quantity: 9 },
    ]);
    expect(result.freshness.sourceLatestUpdatedAt).toBe(now.toISOString());
  });
  it.each(['bad', '-1', '9007199254740992'])(
    'rejects invalid/unsafe count %s',
    async (value) => {
      const data = row();
      data.total = value;
      await expect(setup(data).service.summary('day')).rejects.toMatchObject({
        status: 503,
      });
    },
  );
  it('fails safely on missing buckets, inconsistent totals and database errors', async () => {
    for (const data of [
      { ...row(), trend: [] },
      { ...row(), hours: [] },
      { ...row(), total: '1' },
      { ...row(), hours: row().hours.map((b) => ({ ...b, hour: 24 })) },
      { ...row(), items: [{ id: 'x', name: 'y', quantity: 'bad' }] },
    ])
      await expect(setup(data).service.summary('month')).rejects.toMatchObject({
        status: 503,
      });
    const { service, query } = setup();
    query.mockResolvedValueOnce([]);
    await expect(service.summary('day')).rejects.toMatchObject({ status: 503 });
    query.mockRejectedValue(new Error('private provider data'));
    await expect(service.summary('day')).rejects.toMatchObject({
      status: 503,
      message: 'Service Unavailable',
    });
  });
  it('forwards the validated period through the controller', async () => {
    const { service } = setup();
    expect(
      (await new FoodAnalyticsController(service).summary({ period: 'month' }))
        .period,
    ).toBe('month');
  });
});
