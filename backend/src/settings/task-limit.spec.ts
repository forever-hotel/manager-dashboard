import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TaskLimitController } from './task-limit.controller';
import { TaskLimitService, taskLimitView } from './task-limit.service';
import { UpdateTaskLimitDto } from './task-limit.dto';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
const id = '67f4568c-89ab-4c12-b321-123456789012';
const row = {
  requested_limit: 3,
  version: 0,
  updated_at: new Date('2026-10-21T00:00:00Z'),
  effective_limit: null,
  effective_version: null,
  applied_at: null,
};
function setup() {
  const query = jest.fn().mockResolvedValue([row]);
  const transaction = jest.fn(
    async (
      isolation: string,
      work: (m: { query: typeof query }) => Promise<unknown>,
    ) => {
      expect(isolation).toBe('READ COMMITTED');
      return work({ query });
    },
  );
  return {
    query,
    service: new TaskLimitService({
      query,
      transaction,
    } as unknown as DataSource),
  };
}
describe('DDP-045 versioned requested and effective task limits', () => {
  it('returns the seeded default as pending, never fabricates WKMS confirmation', async () => {
    const { service, query } = setup();
    const controller = new TaskLimitController(service);
    expect(await controller.get({})).toMatchObject({
      limit: 3,
      version: 0,
      effectiveLimit: null,
      effectiveVersion: null,
      status: 'PENDING',
      activeStates: ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED'],
      assignedWorkerRequired: true,
    });
    query.mockResolvedValueOnce([
      {
        ...row,
        effective_limit: 3,
        effective_version: 0,
        applied_at: row.updated_at,
      },
    ]);
    expect((await service.get()).status).toBe('EFFECTIVE');
    query.mockResolvedValueOnce([
      {
        ...row,
        requested_limit: 2,
        version: 1,
        effective_limit: 3,
        effective_version: 0,
        applied_at: row.updated_at,
      },
    ]);
    expect(await service.get()).toMatchObject({
      limit: 2,
      effectiveLimit: 3,
      status: 'PENDING',
    });
  });
  it.each([1, 10])(
    'stores valid limit %s and an actor/version audit without claiming effectiveness',
    async (limit) => {
      const { service, query } = setup();
      query
        .mockResolvedValueOnce([row])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { ...row, version: 1, requested_limit: limit },
        ]);
      const controller = new TaskLimitController(service);
      expect(
        await controller.update(
          { limit, version: 0 },
          { user: { sub: id } } as AuthenticatedRequest,
          {},
        ),
      ).toMatchObject({
        limit,
        version: 1,
        status: 'PENDING',
        effectiveLimit: null,
      });
      expect(query).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('FOR UPDATE OF p'),
      );
      expect(query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO public.mad_task_limit_history'),
        [1, limit, id],
      );
      expect(query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('UPDATE public.mad_task_limit_policy'),
        [limit, 1, id],
      );
    },
  );
  it('keeps no-op saves idempotent and rejects stale/exhausted versions before writing', async () => {
    const { service, query } = setup();
    expect((await service.update({ limit: 3, version: 0 }, id)).version).toBe(
      0,
    );
    expect(query).toHaveBeenCalledTimes(1);
    await expect(
      service.update({ limit: 4, version: 1 }, id),
    ).rejects.toMatchObject({ status: 409 });
    query.mockResolvedValueOnce([{ ...row, version: 2147483647 }]);
    await expect(
      service.update({ limit: 4, version: 2147483647 }, id),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('rejects corrupt/missing policy or acknowledgements and sanitizes storage errors', async () => {
    const invalid = [
      undefined,
      { ...row, requested_limit: 0 },
      { ...row, requested_limit: 11 },
      { ...row, requested_limit: 2.5 },
      { ...row, version: -1 },
      { ...row, version: 2147483648 },
      { ...row, updated_at: new Date('bad') },
      { ...row, updated_at: 'bad' },
      { ...row, effective_limit: 3 },
      { ...row, applied_at: row.updated_at },
      {
        ...row,
        effective_version: 1,
        effective_limit: 3,
        applied_at: row.updated_at,
      },
      {
        ...row,
        effective_version: 0,
        effective_limit: 2,
        applied_at: row.updated_at,
      },
      {
        ...row,
        effective_version: -1,
        effective_limit: 3,
        applied_at: row.updated_at,
      },
      {
        ...row,
        effective_version: 0,
        effective_limit: 0,
        applied_at: row.updated_at,
      },
      {
        ...row,
        effective_version: 0,
        effective_limit: 3,
        applied_at: new Date('bad'),
      },
      { ...row, effective_version: 0, effective_limit: 3, applied_at: null },
    ];
    for (const source of invalid)
      expect(() => taskLimitView(source as typeof row)).toThrow();
    const { service, query } = setup();
    for (const rows of [[], [row, row]]) {
      query.mockResolvedValueOnce(rows);
      await expect(service.get()).rejects.toMatchObject({ status: 503 });
    }
    query.mockResolvedValueOnce([]);
    await expect(
      service.update({ limit: 2, version: 0 }, id),
    ).rejects.toMatchObject({ status: 503 });
    query.mockRejectedValueOnce(new Error('private SQL'));
    await expect(service.get()).rejects.toMatchObject({
      status: 503,
      message: 'Service Unavailable',
    });
    query.mockRejectedValueOnce(new Error('private SQL'));
    await expect(
      service.update({ limit: 2, version: 0 }, id),
    ).rejects.toMatchObject({ status: 503, message: 'Service Unavailable' });
  });
  it('validates integer bounds, explicit version and unexpected input', async () => {
    for (const limit of [1, 3, 10])
      expect(
        await validate(
          plainToInstance(UpdateTaskLimitDto, { limit, version: 0 }),
        ),
      ).toEqual([]);
    for (const input of [
      { limit: 0, version: 0 },
      { limit: 11, version: 0 },
      { limit: 2.5, version: 0 },
      { limit: '3', version: 0 },
      { limit: null, version: 0 },
      { limit: 3 },
      { limit: 3, version: -1 },
      { limit: 3, version: '0' },
      { limit: 3, version: 0, extra: true },
    ])
      expect(
        (
          await validate(plainToInstance(UpdateTaskLimitDto, input), {
            whitelist: true,
            forbidNonWhitelisted: true,
          })
        ).length,
      ).toBeGreaterThan(0);
  });
});
