import { DataSource } from 'typeorm';
import { KitchenService } from './kitchen.service';
import { KitchenController } from './kitchen.controller';
import { KitchenQueryDto } from './kitchen-query.dto';
const now = new Date('2026-10-19T06:00:00Z');
describe('DDP-041 kitchen snapshot', () => {
  const snapshot = {
    orders: [],
    total: 0,
    counts: { PLACED: 0, IN_PREPARATION: 0, READY: 0, DELIVERED: 0 },
    asOf: now.toISOString(),
    deliveredSince: now.toISOString(),
  };
  it('returns a valid empty page and parameterizes the filters and clock', async () => {
    const query = jest.fn().mockResolvedValue([{ snapshot }]);
    const service = new KitchenService(
      { query } as unknown as DataSource,
      () => now,
    );
    expect(
      await new KitchenController(service).orders(new KitchenQueryDto()),
    ).toMatchObject({ ...snapshot, page: 1, pageSize: 20 });
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
  it('preserves order counts and safe integer versions', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        snapshot: {
          ...snapshot,
          total: 1,
          orders: [{ version: 123, itemCount: 2 }],
        },
      },
    ]);
    expect(
      (
        await new KitchenService({ query } as unknown as DataSource).snapshot(
          new KitchenQueryDto(),
        )
      ).total,
    ).toBe(1);
  });
  it('rejects missing, unsafe and failed source results instead of returning false zeros', async () => {
    const query = jest.fn();
    const service = new KitchenService({ query } as unknown as DataSource);
    for (const rows of [
      [],
      [{ snapshot: { ...snapshot, orders: null } }],
      [{ snapshot: { ...snapshot, total: -1 } }],
      [{ snapshot: { ...snapshot, total: 9007199254740992 } }],
    ]) {
      query.mockResolvedValueOnce(rows);
      await expect(
        service.snapshot(new KitchenQueryDto()),
      ).rejects.toMatchObject({ status: 503 });
    }
    query.mockRejectedValue(new Error('private SQL'));
    await expect(service.snapshot(new KitchenQueryDto())).rejects.toMatchObject(
      { status: 503, message: 'Service Unavailable' },
    );
  });
});
