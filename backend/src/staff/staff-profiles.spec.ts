import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource } from 'typeorm';
import { CredentialCipher } from './credential-cipher';
import { StaffProfile, StaffProfilesService } from './staff-profiles.service';
import { UpdateStaffDto } from './update-staff.dto';

const profile: StaffProfile = {
  staffId: 'staff-id',
  name: 'Staff Name',
  vocation: 'Reception',
  email: 'staff@example.com',
  age: 25,
  phone: '+94771234567',
  nic: '200012345678',
  username: 'staff_test',
  role: 'RECEPTIONIST',
  isActive: true,
  passwordChangeRequired: true,
  version: 0
};
const cipher = new CredentialCipher(
  new ConfigService({
    STAFF_CREDENTIALS_KEY: Buffer.alloc(32, 4).toString('base64')
  })
);
function setup(rows: unknown[] = [profile], after = { ...profile, version: 1 }) {
  const query = jest
    .fn<Promise<unknown[]>, [string, unknown[]]>()
    .mockResolvedValueOnce(rows)
    .mockResolvedValueOnce([[after], 1])
    .mockResolvedValue([]);
  const transaction = jest.fn(async (work: (manager: { query: typeof query }) => Promise<unknown>) => work({ query }));
  return {
    query,
    transaction,
    service: new StaffProfilesService({ query, transaction } as unknown as DataSource, cipher)
  };
}
describe('DDP-014 profile validation', () => {
  it('accepts partial normalized profile changes and deactivation', async () => {
    const dto = plainToInstance(UpdateStaffDto, {
      version: 0,
      email: ' STAFF@EXAMPLE.COM ',
      isActive: false
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto.email).toBe(profile.email);
  });
  it.each([
    { version: null },
    { version: 0, name: null },
    { version: 0, age: '25' },
    { version: 0, role: 'MANAGER' },
    { version: 0, isActive: true },
    { version: 0, isActive: null },
    { version: 0, phone: 'bad' },
    { version: 0, nic: 'bad' },
    { version: 0, name: '<script>' },
    { version: 0, vocation: '' },
    { version: 0, email: null },
    { version: 2147483647 }
  ])('rejects invalid patch %j', async input => {
    expect((await validate(plainToInstance(UpdateStaffDto, input))).length).toBeGreaterThan(0);
  });
});
describe('DDP-014 profile service', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  it('returns only the selected profile', async () => {
    const { service } = setup();
    expect(await service.get(profile.staffId)).toEqual(profile);
  });
  it('audits field names, actor and outcome without profile values', async () => {
    const after = { ...profile, name: 'Private Name', version: 1 };
    const { service } = setup([profile], after);
    expect(
      await service.update(profile.staffId, 'manager-id', {
        version: 0,
        name: after.name
      })
    ).toEqual(after);
    expect(log).toHaveBeenCalledWith({
      event: 'staff.profile_updated',
      actorId: 'manager-id',
      staffId: profile.staffId,
      fields: ['name'],
      version: 1,
      outcome: 'saved'
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(after.name);
  });
  it.each([{ rows: [] }, { rows: [{ ...profile, role: 'MANAGER' }] }])(
    'rejects unknown or manager targets for reads and edits',
    async ({ rows }) => {
      await expect(setup(rows).service.get(profile.staffId)).rejects.toMatchObject({ status: 404 });
      const { service, query } = setup(rows);
      await expect(
        service.update(profile.staffId, 'manager-id', {
          version: 0,
          name: 'New'
        })
      ).rejects.toMatchObject({ status: 404 });
      expect(query).toHaveBeenCalledTimes(1);
    }
  );
  it('rejects empty edits before querying and stale edits before updating', async () => {
    const { service, query } = setup();
    await expect(service.update(profile.staffId, 'manager-id', { version: 0 })).rejects.toMatchObject({ status: 400 });
    expect(query).not.toHaveBeenCalled();
    await expect(
      service.update(profile.staffId, 'manager-id', {
        version: 2,
        name: 'New'
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each([{ code: '23505' }, { driverError: { code: '23505' } }, new Error('private failure'), null])(
    'sanitizes storage errors %j',
    async error => {
      const { service, transaction } = setup();
      transaction.mockRejectedValue(error);
      await expect(
        service.update(profile.staffId, 'manager-id', {
          version: 0,
          name: 'New'
        })
      ).rejects.toMatchObject({
        status: error && !(error instanceof Error) ? 409 : 503
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private failure');
    }
  );
  it('sanitizes failed profile reads', async () => {
    const { service, query } = setup();
    query.mockReset().mockRejectedValue(new Error('private'));
    await expect(service.get(profile.staffId)).rejects.toMatchObject({
      status: 503
    });
  });
  const credentials = {
    email: profile.email,
    username: profile.username,
    role: profile.role,
    password: 'test-only-temporary'
  };
  it('rebinds a pending password to the edited recipient and version', async () => {
    const after = { ...profile, email: 'new@example.com', version: 1 };
    const { service, query } = setup();
    query
      .mockReset()
      .mockResolvedValueOnce([profile])
      .mockResolvedValueOnce([[after], 1])
      .mockResolvedValueOnce([
        {
          delivery_id: 'old',
          encrypted_credentials: cipher.encrypt('old', credentials),
          credential_version: 0
        }
      ])
      .mockResolvedValue([]);
    await service.update(profile.staffId, 'manager-id', {
      version: 0,
      email: after.email
    });
    const args = query.mock.calls[3][1] as [string, string, string, number];
    expect(cipher.decrypt(args[1], args[2])).toEqual({
      ...credentials,
      email: after.email
    });
    expect(args[3]).toBe(1);
  });
  it.each([
    { after: { ...profile, isActive: false, version: 1 }, version: 0 },
    {
      after: { ...profile, passwordChangeRequired: false, version: 1 },
      version: 0
    },
    { after: { ...profile, version: 1 }, version: 9 }
  ])('cancels obsolete credential delivery without decrypting', async ({ after, version }) => {
    const { service, query } = setup();
    query
      .mockReset()
      .mockResolvedValueOnce([profile])
      .mockResolvedValueOnce([[after], 1])
      .mockResolvedValueOnce([
        {
          delivery_id: 'old',
          encrypted_credentials: 'invalid',
          credential_version: version
        }
      ])
      .mockResolvedValue([]);
    await service.update(profile.staffId, 'manager-id', {
      version: 0,
      name: 'New'
    });
    expect(query.mock.calls[3][0]).toContain("status='cancelled'");
    expect(query.mock.calls[3][1]).toEqual(['old']);
  });
  it('fails safely when pending credentials cannot be decrypted', async () => {
    const { service, query } = setup();
    query
      .mockReset()
      .mockResolvedValueOnce([profile])
      .mockResolvedValueOnce([[{ ...profile, version: 1 }], 1])
      .mockResolvedValueOnce([
        {
          delivery_id: 'old',
          encrypted_credentials: 'invalid',
          credential_version: 0
        }
      ]);
    await expect(
      service.update(profile.staffId, 'manager-id', {
        version: 0,
        name: 'New'
      })
    ).rejects.toMatchObject({ status: 503 });
  });
});
