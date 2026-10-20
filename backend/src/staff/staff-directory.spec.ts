import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StaffDirectoryService } from './staff-directory.service';
import { StaffDirectoryDto } from './staff-directory.dto';
describe('DDP-044 staff directory', () => {
  it('parameterizes literal searches, filters and paging with safe field projection', async () => {
    const query = jest.fn().mockResolvedValue([{ items: [], total: 0 }]);
    const service = new StaffDirectoryService({
      query,
    } as unknown as DataSource);
    expect(
      await service.list(
        Object.assign(new StaffDirectoryDto(), {
          search: '%_',
          role: 'WORKER',
          status: 'inactive',
          page: 2,
          pageSize: 10,
        }),
      ),
    ).toMatchObject({ items: [], total: 0, page: 2 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('strpos'), [
      expect.any(Array),
      '%_',
      'WORKER',
      false,
      10,
      10,
      null,
    ]);
    await service.list(
      Object.assign(new StaffDirectoryDto(), { status: 'active' }),
    );
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [
      expect.any(Array),
      null,
      null,
      true,
      20,
      0,
      null,
    ]);
  });
  it('returns details, handles unknown IDs and sanitizes storage failures', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { items: [{ staffId: 'id', deliveryStatus: 'failed' }], total: 1 },
      ])
      .mockResolvedValueOnce([{ items: [], total: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ items: null }])
      .mockRejectedValue(new Error('private SQL'));
    const service = new StaffDirectoryService({
      query,
    } as unknown as DataSource);
    expect(await service.get('id')).toMatchObject({ deliveryStatus: 'failed' });
    await expect(service.get('missing')).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < 3; i++)
      await expect(service.list(new StaffDirectoryDto())).rejects.toMatchObject(
        { status: 503 },
      );
  });
  it('validates bounds, roles and unknown query fields', async () => {
    expect(await validate(new StaffDirectoryDto())).toEqual([]);
    for (const input of [
      { page: 0 },
      { pageSize: 101 },
      { role: 'MANAGER' },
      { status: 'bad' },
      { search: 'x'.repeat(101) },
      { unknown: 1 },
    ])
      expect(
        (
          await validate(plainToInstance(StaffDirectoryDto, input), {
            whitelist: true,
            forbidNonWhitelisted: true,
          })
        ).length,
      ).toBeGreaterThan(0);
  });
});
