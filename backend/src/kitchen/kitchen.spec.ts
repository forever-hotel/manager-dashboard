import { DataSource } from 'typeorm';
import { KitchenService } from './kitchen.service';
import { KitchenController } from './kitchen.controller';
import { KitchenQueryDto } from './kitchen-query.dto';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
const now = new Date('2026-10-19T06:00:00Z');
const updatedAt = '2026-10-19T01:00:00.123456Z';
const order = {
  id: '67f4568c-89ab-4c12-b321-123456789012',
  roomNumber: '101',
  mealPeriod: 'LUNCH',
  status: 'PLACED',
  placedAt: '2026-10-19T00:00:00Z',
  updatedAt,
  version: Date.parse(updatedAt) * 1000 + 456,
  itemCount: 2,
};
const empty = {
  invalidSource: false,
  orders: [],
  total: 0,
  counts: { PLACED: 0, IN_PREPARATION: 0, READY: 0, DELIVERED: 0 },
  asOf: now.toISOString(),
  deliveredSince: '2026-10-18T18:30:00Z',
};
const populated = {
  ...empty,
  orders: [order],
  total: 1,
  counts: { ...empty.counts, PLACED: 1 },
};
function setup(source: unknown = empty) {
  const query = jest.fn().mockResolvedValue([{ snapshot: source }]);
  return {
    query,
    service: new KitchenService({ query } as unknown as DataSource, () => now),
  };
}
describe('DDP-041 kitchen snapshot', () => {
  it('resolves the explicit database token and optional clock through Nest', async () => {
    const query = jest.fn().mockResolvedValue([{ snapshot: empty }]);
    const module = await Test.createTestingModule({
      providers: [
        KitchenService,
        { provide: getDataSourceToken(), useValue: { query } },
        { provide: 'KITCHEN_CLOCK', useValue: () => now },
      ],
    }).compile();
    try {
      const response = await module
        .get(KitchenService)
        .snapshot(new KitchenQueryDto());
      expect(response.asOf).toBe(now.toISOString());
      expect(query).toHaveBeenCalledWith(expect.any(String), [
        null,
        20,
        0,
        now.toISOString(),
      ]);
    } finally {
      await module.close();
    }
  });
  it('uses the current system time when the optional kitchen clock is not injected', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(now);
    try {
      const query = jest.fn().mockResolvedValue([{ snapshot: empty }]);
      const service = new KitchenService({ query } as unknown as DataSource);

      const response = await service.snapshot(new KitchenQueryDto());

      expect(response.asOf).toBe(now.toISOString());
      expect(response.orders).toEqual([]);
      expect(query).toHaveBeenCalledWith(expect.any(String), [
        null,
        20,
        0,
        now.toISOString(),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
  it('returns valid empty pages with parameterized filters and a consistent clock', async () => {
    const { service, query } = setup();
    const response = await new KitchenController(service).orders(
      new KitchenQueryDto(),
    );
    expect(response).toMatchObject({
      orders: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
    expect(response).not.toHaveProperty('invalidSource');
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      null,
      20,
      0,
      now.toISOString(),
    ]);
    await service.snapshot({ status: 'READY', page: 2, pageSize: 5 });
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      'READY',
      5,
      5,
      now.toISOString(),
    ]);
  });
  it.each(['PLACED', 'IN_PREPARATION', 'READY', 'DELIVERED'])(
    'preserves exact identity/revision and counts for %s',
    async (status) => {
      const { service } = setup({
        ...populated,
        counts: { ...empty.counts, [status]: 1 },
        orders: [{ ...order, status, password: 'private' }],
        internal: 'private',
      });
      const response = await service.snapshot({
        status,
        page: 1,
        pageSize: 20,
      });
      expect(response.orders).toEqual([{ ...order, status }]);
      expect(response.orders[0].version).toBe(
        Date.parse(updatedAt) * 1000 + 456,
      );
      expect(JSON.stringify(response)).not.toContain('private');
    },
  );
  it('allows an out-of-range empty page without discarding global counts', async () => {
    const { service } = setup({ ...populated, orders: [] });
    expect(await service.snapshot({ page: 2, pageSize: 20 })).toMatchObject({
      orders: [],
      total: 1,
      counts: populated.counts,
    });
  });
  it('rejects missing, malformed, inconsistent and unsafe source results as unavailable', async () => {
    const { service, query } = setup();
    const invalid: unknown[] = [
      null,
      [],
      { ...empty, invalidSource: true },
      { ...empty, invalidSource: undefined },
      { ...empty, counts: {} },
      { ...empty, counts: { ...empty.counts, UNKNOWN: 0 } },
      { ...empty, counts: { ...empty.counts, PLACED: -1 } },
      { ...empty, total: 9007199254740992 },
      { ...empty, total: '0' },
      { ...empty, total: 1 },
      { ...empty, orders: null },
      { ...empty, asOf: 'bad' },
      { ...empty, asOf: '2026-10-19T05:00:00Z' },
      { ...empty, deliveredSince: '2026-10-20T00:00:00Z' },
      { ...empty, deliveredSince: '2026-10-17T00:00:00Z' },
      { ...populated, orders: [] },
      {
        ...populated,
        total: 2,
        counts: { ...empty.counts, PLACED: 2 },
        orders: [order, order],
      },
    ];
    for (const patch of [
      { id: 'bad' },
      { status: 'UNKNOWN' },
      { status: 'READY' },
      { roomNumber: '' },
      { mealPeriod: 'x'.repeat(41) },
      { roomNumber: '\u0000' },
      { placedAt: '2026-02-30T00:00:00Z' },
      { updatedAt: '2026-10-19T01:00:00' },
      { updatedAt: '2026-10-19T01:00:00.1234567Z' },
      { version: order.version + 1 },
      { itemCount: -1 },
      { itemCount: 9007199254740992 },
    ])
      invalid.push({ ...populated, orders: [{ ...order, ...patch }] });
    for (const source of invalid) {
      query.mockResolvedValueOnce([{ snapshot: source }]);
      await expect(
        service.snapshot(new KitchenQueryDto()),
      ).rejects.toMatchObject({ status: 503 });
    }
    query.mockResolvedValueOnce([]);
    await expect(service.snapshot(new KitchenQueryDto())).rejects.toMatchObject(
      { status: 503 },
    );
    query.mockRejectedValueOnce(new Error('private SQL'));
    await expect(service.snapshot(new KitchenQueryDto())).rejects.toMatchObject(
      { status: 503, message: 'Service Unavailable' },
    );
  });
});
