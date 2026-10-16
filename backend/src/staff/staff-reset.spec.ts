import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare } from 'bcryptjs';
import { DataSource } from 'typeorm';
import { CredentialCipher } from './credential-cipher';
import { StaffService } from './staff.service';

const account = {
  username: 'staff_test',
  email: 'staff@example.com',
  role: 'WORKER',
  is_active: true,
  session_version: 3,
};
function setup(rows: unknown[] = [account], configured = true) {
  const query = jest
    .fn<Promise<unknown[]>, [string, unknown[]]>()
    .mockResolvedValueOnce(rows)
    .mockResolvedValue([]);
  const transaction = jest.fn(
    async (work: (manager: { query: typeof query }) => Promise<unknown>) =>
      work({ query }),
  );
  const cipher = new CredentialCipher(
    new ConfigService(
      configured
        ? {
            STAFF_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64'),
          }
        : {},
    ),
  );
  return {
    query,
    transaction,
    cipher,
    service: new StaffService({ transaction } as unknown as DataSource, cipher),
  };
}
describe('DDP-013 staff password reset', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  it('given active staff, replaces credentials, increments version and records a secret-free audit', async () => {
    const { service, query, cipher } = setup();
    const result = await service.resetPassword('staff-id', 'actor-id');
    const update = query.mock.calls[1][1];
    const delivery = query.mock.calls[2][1];
    const credentials = cipher.decrypt(
      result.deliveryId,
      delivery[2] as string,
    );
    expect(await compare(credentials.password, update[1] as string)).toBe(true);
    expect(update[2]).toBe(4);
    expect(delivery[3]).toBe(4);
    expect(credentials).toMatchObject({
      username: account.username,
      email: account.email,
    });
    expect(result).toEqual({
      staffId: 'staff-id',
      deliveryId: result.deliveryId,
      deliveryStatus: 'pending',
    });
    expect(log).toHaveBeenCalledWith({
      event: 'staff.password_reset',
      actorId: 'actor-id',
      staffId: 'staff-id',
      outcome: 'queued',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(credentials.password);
  });
  it.each([
    [[], 404],
    [[{ ...account, role: 'MANAGER' }], 404],
    [[{ ...account, is_active: false }], 409],
  ])(
    'given ineligible staff, returns the domain error without writes',
    async (rows, status) => {
      const { service, query } = setup(rows);
      await expect(
        service.resetPassword('staff-id', 'actor-id'),
      ).rejects.toMatchObject({ status });
      expect(query).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: status }),
      );
    },
  );
  it('given no encryption key, fails before updating the account', async () => {
    const { service, query } = setup([account], false);
    await expect(
      service.resetPassword('staff-id', 'actor-id'),
    ).rejects.toMatchObject({ status: 503 });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('given a database failure, conceals its details in response and audit', async () => {
    const { service, transaction } = setup();
    transaction.mockRejectedValue(new Error('private database details'));
    await expect(
      service.resetPassword('staff-id', 'actor-id'),
    ).rejects.toMatchObject({ status: 503 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      'private database details',
    );
  });
});
