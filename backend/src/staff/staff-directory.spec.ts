import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StaffDirectoryService } from './staff-directory.service';
import { StaffDirectoryDto } from './staff-directory.dto';
const id = '67f4568c-89ab-4c12-b321-123456789012';
const staff = {
  staffId: id,
  name: 'Staff One',
  vocation: 'Reception',
  email: 'staff@example.com',
  age: 25,
  phone: '+94771234567',
  nic: '200012345678',
  username: 'staff_one',
  role: 'WORKER',
  isActive: true,
  passwordChangeRequired: true,
  version: 0,
  deliveryStatus: 'failed',
};
describe('DDP-044 staff directory', () => {
  it.each(['RECEPTIONIST', 'WORKER', 'KITCHEN_STAFF', 'KITCHEN_MANAGER'])(
    'retains matching role/status and nullable legacy fields for %s',
    async (role) => {
      for (const isActive of [true, false]) {
        const query = jest
          .fn()
          .mockResolvedValue([
            { items: [{ ...staff, role, isActive }], total: 1 },
          ]);
        const service = new StaffDirectoryService({
          query,
        } as unknown as DataSource);
        expect(
          (
            await service.list(
              Object.assign(new StaffDirectoryDto(), {
                role,
                status: isActive ? 'active' : 'inactive',
              }),
            )
          ).items[0],
        ).toMatchObject({ role, isActive });
      }
    },
  );
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
      .mockResolvedValueOnce([{ items: [staff], total: 1 }])
      .mockResolvedValueOnce([{ items: [], total: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ items: null }])
      .mockRejectedValue(new Error('private SQL'));
    const service = new StaffDirectoryService({
      query,
    } as unknown as DataSource);
    expect(await service.get(id)).toMatchObject({ deliveryStatus: 'failed' });
    await expect(service.get(id)).rejects.toMatchObject({ status: 404 });
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
      { page: '1e2' },
      { page: '0x10' },
      { pageSize: '1.0' },
      { page: ['1', '2'] },
      { search: 'bad\u0000value' },
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
  it('projects only authorized fields and rejects inconsistent source pages or profiles', async () => {
    const query = jest.fn();
    const service = new StaffDirectoryService({
      query,
    } as unknown as DataSource);
    query.mockResolvedValueOnce([
      {
        items: [
          {
            ...staff,
            password_hash: 'private',
            encrypted_credentials: 'private',
          },
        ],
        total: 1,
        password: 'private',
      },
    ]);
    expect(await service.get(id)).toEqual(staff);
    query.mockResolvedValueOnce([
      {
        items: [
          {
            ...staff,
            phone: null,
            nic: null,
            age: null,
            deliveryStatus: 'none',
          },
        ],
        total: 1,
      },
    ]);
    expect(
      (await service.list(new StaffDirectoryDto())).items[0],
    ).toMatchObject({
      phone: null,
      nic: null,
      age: null,
      deliveryStatus: 'none',
    });
    query.mockResolvedValueOnce([{ items: [], total: 1 }]);
    expect(await service.list({ page: 2, pageSize: 20 })).toMatchObject({
      items: [],
      total: 1,
    });
    const invalid: unknown[] = [
      { items: [], total: -1 },
      { items: [], total: '0' },
      { items: [], total: 9007199254740992 },
      { items: [], total: 1 },
      { items: [staff, staff], total: 2 },
    ];
    for (const patch of [
      { staffId: 'bad' },
      { role: 'MANAGER' },
      { isActive: 'true' },
      { passwordChangeRequired: 0 },
      { version: -1 },
      { version: 2147483648 },
      { version: 0.5 },
      { deliveryStatus: 'unknown' },
      { name: '' },
      { name: 3 },
      { vocation: 'x'.repeat(101) },
      { email: 'bad\u0000value' },
      { username: ' ' },
      { phone: 3 },
      { nic: 'x'.repeat(51) },
      { age: 0 },
      { age: 121 },
      { age: 1.5 },
    ])
      invalid.push({ items: [{ ...staff, ...patch }], total: 1 });
    invalid.push({ items: [null], total: 1 });
    for (const source of invalid) {
      query.mockResolvedValueOnce([source]);
      await expect(service.list(new StaffDirectoryDto())).rejects.toMatchObject(
        { status: 503 },
      );
    }
    for (const filter of [{ role: 'RECEPTIONIST' }, { status: 'inactive' }]) {
      query.mockResolvedValueOnce([{ items: [staff], total: 1 }]);
      await expect(
        service.list(Object.assign(new StaffDirectoryDto(), filter)),
      ).rejects.toMatchObject({ status: 503 });
    }
    query.mockResolvedValueOnce([{ items: [staff], total: 1 }]);
    await expect(
      service.get('77f4568c-89ab-4c12-b321-123456789012'),
    ).rejects.toMatchObject({ status: 503 });
    query.mockResolvedValueOnce([{ items: [staff, staff], total: 2 }]);
    await expect(service.get(id)).rejects.toMatchObject({ status: 503 });
    query.mockRejectedValueOnce(new Error('private SQL'));
    await expect(service.get(id)).rejects.toMatchObject({
      status: 503,
      message: 'Service Unavailable',
    });
  });
});
