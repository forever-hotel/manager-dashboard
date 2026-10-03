import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { InitialManagerService } from './initial-manager.service';
import { hashPassword } from './password';

jest.mock('./password', () => ({
  hashPassword: jest.fn().mockResolvedValue('hashed-password'),
  validPassword: (value: string) => value.length >= 12 && value.length <= 1024,
}));

describe('Initial manager startup', () => {
  const settings = {
    INITIAL_MANAGER_EMAIL: ' Manager@Example.com ',
    INITIAL_MANAGER_USERNAME: ' Manager ',
    INITIAL_MANAGER_PASSWORD: 'private-initial-password',
  };
  let query: jest.Mock;
  let transaction: jest.Mock;
  function service(config: Record<string, string> = settings) {
    return new InitialManagerService(new ConfigService(config), {
      transaction,
    } as unknown as DataSource);
  }
  beforeEach(() => {
    jest.clearAllMocks();
    query = jest.fn().mockResolvedValue([]);
    transaction = jest.fn((work: (manager: { query: jest.Mock }) => unknown) =>
      work({ query }),
    );
  });
  it('does nothing when disabled', async () => {
    await service({}).onApplicationBootstrap();
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects partial configuration without leaking credentials', async () => {
    await expect(
      service({
        INITIAL_MANAGER_PASSWORD: settings.INITIAL_MANAGER_PASSWORD,
      }).onApplicationBootstrap(),
    ).rejects.toThrow('Configure INITIAL_MANAGER_EMAIL');
    expect(transaction).not.toHaveBeenCalled();
  });
  it('creates a new manager with a hashed password and mandatory change flag', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ worker_id: 'new-id' }]);
    await service().onApplicationBootstrap();
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('lower(email)'),
      ['manager@example.com'],
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("'MANAGER',true,true"),
      ['manager@example.com', 'manager', 'hashed-password'],
    );
  });
  it.each([true, false])(
    'preserves an existing manager with password_change_required=%s',
    async (password_change_required) => {
      query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ role: 'MANAGER', password_change_required }]);
      await service().onApplicationBootstrap();
      expect(query).toHaveBeenCalledTimes(2);
      expect(hashPassword).not.toHaveBeenCalled();
    },
  );
  it('ignores obsolete initial credentials when the manager already exists', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ role: 'MANAGER' }]);
    await service({
      INITIAL_MANAGER_EMAIL: 'manager@example.com',
    }).onApplicationBootstrap();
    expect(query).toHaveBeenCalledTimes(2);
    expect(hashPassword).not.toHaveBeenCalled();
  });
  it('requires initial credentials when the account does not exist', async () => {
    await expect(
      service({
        INITIAL_MANAGER_EMAIL: 'manager@example.com',
      }).onApplicationBootstrap(),
    ).rejects.toThrow('Initial manager provisioning failed');
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('does not promote an existing non-manager', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ role: 'WORKER' }]);
    await expect(service().onApplicationBootstrap()).rejects.toThrow(
      'Initial manager provisioning failed',
    );
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('fails safely on a username conflict without updating any account', async () => {
    await expect(service().onApplicationBootstrap()).rejects.toThrow(
      'Initial manager provisioning failed',
    );
    expect(
      query.mock.calls.some(([sql]: [string]) => sql.includes('UPDATE')),
    ).toBe(false);
  });
});
