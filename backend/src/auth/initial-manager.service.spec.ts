import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { InitialManagerService } from './initial-manager.service';
import { CredentialCipher } from '../staff/credential-cipher';
import { hashPassword } from './password';
jest.mock('./password', () => ({ hashPassword: jest.fn().mockResolvedValue('hashed-password') }));
describe('Initial ROOT provisioning', () => {
  const settings = {
    INITIAL_MANAGER_EMAIL: ' MadushanP835@gmail.com ',
    INITIAL_MANAGER_USERNAME: ' Manager ',
    STAFF_EMAIL_ENABLED: 'true'
  };
  let query: jest.Mock;
  let transaction: jest.Mock;
  let encrypt: jest.Mock;
  function service(config: Record<string, string> = settings) {
    return new InitialManagerService(
      new ConfigService(config),
      { transaction } as unknown as DataSource,
      { encrypt } as unknown as CredentialCipher
    );
  }
  beforeEach(() => {
    jest.clearAllMocks();
    query = jest.fn().mockResolvedValue([]);
    transaction = jest.fn(work => work({ query }));
    encrypt = jest.fn().mockReturnValue('encrypted-credentials');
  });
  it('does nothing when disabled', async () => {
    await service({}).onApplicationBootstrap();
    expect(transaction).not.toHaveBeenCalled();
  });
  it('validates email before any database access', async () => {
    await expect(service({ INITIAL_MANAGER_USERNAME: 'manager' }).onApplicationBootstrap()).rejects.toThrow(
      'Configure a valid INITIAL_MANAGER_EMAIL'
    );
    expect(transaction).not.toHaveBeenCalled();
  });
  it('creates ROOT and queues its random credentials atomically', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ worker_id: 'new-id', session_version: 0 }]);
    await service().onApplicationBootstrap();
    const [deliveryId, payload] = encrypt.mock.calls[0] as [
      string,
      { email: string; username: string; password: string; role: string }
    ];
    expect(payload).toMatchObject({ email: 'madushanp835@gmail.com', username: 'manager', role: 'ROOT' });
    expect(payload.password).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(hashPassword).toHaveBeenCalledWith(payload.password);
    expect(query).toHaveBeenNthCalledWith(3, expect.stringContaining("ARRAY['ROOT']::text[],true,true"), [
      'madushanp835@gmail.com',
      'manager',
      'hashed-password'
    ]);
    expect(query).toHaveBeenNthCalledWith(4, expect.stringContaining('mad_staff_deliveries'), [
      deliveryId,
      'new-id',
      'encrypted-credentials',
      0
    ]);
    expect(query.mock.calls.flat()).not.toContain(payload.password);
  });
  it('defaults the internal username to manager', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ worker_id: 'new-id', session_version: 0 }]);
    await service({ INITIAL_MANAGER_EMAIL: 'root@example.com', STAFF_EMAIL_ENABLED: 'true' }).onApplicationBootstrap();
    expect(encrypt).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ username: 'manager' }));
  });
  it.each([true, false])(
    'preserves ROOT with password_change_required=%s on every restart',
    async password_change_required => {
      for (let i = 0; i < 2; i++) {
        query
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ role: 'MANAGER', roles: ['ROOT'], password_change_required }]);
        await service().onApplicationBootstrap();
      }
      expect(query).toHaveBeenCalledTimes(4);
      expect(encrypt).not.toHaveBeenCalled();
      expect(hashPassword).not.toHaveBeenCalled();
      expect(query.mock.calls.some(([sql]) => /^\s*(INSERT|UPDATE)\b/.test(sql))).toBe(false);
    }
  );
  it('preserves legacy manager credentials when promoting its roles', async () => {
    query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ role: 'MANAGER', roles: ['MANAGER'] }])
      .mockResolvedValueOnce([[{ worker_id: 'old' }], 1]);
    await service().onApplicationBootstrap();
    expect(query.mock.calls[2][0]).toContain("roles=ARRAY['ROOT']");
    expect(query.mock.calls[2][0]).not.toMatch(/password_hash|password_change_required/);
    expect(encrypt).not.toHaveBeenCalled();
  });
  it('existing ROOT does not require email sending to be enabled', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ role: 'MANAGER', roles: ['ROOT'] }]);
    await service({ INITIAL_MANAGER_EMAIL: 'root@example.com' }).onApplicationBootstrap();
    expect(encrypt).not.toHaveBeenCalled();
  });
  it('fails before creating an inaccessible account when email is disabled', async () => {
    await expect(service({ ...settings, STAFF_EMAIL_ENABLED: 'false' }).onApplicationBootstrap()).rejects.toThrow(
      'provisioning failed'
    );
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('fails safely if encryption configuration or delivery persistence fails', async () => {
    encrypt.mockImplementation(() => {
      throw new Error('private key details');
    });
    await expect(service().onApplicationBootstrap()).rejects.toThrow('provisioning failed');
    expect(hashPassword).not.toHaveBeenCalled();
  });
  it('does not overwrite a conflicting account or username', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ role: 'WORKER', roles: ['WORKER'] }]);
    await expect(service().onApplicationBootstrap()).rejects.toThrow('provisioning failed');
    expect(encrypt).not.toHaveBeenCalled();
  });
  it('rejects a new-account insertion conflict and never queues credentials', async () => {
    await expect(service().onApplicationBootstrap()).rejects.toThrow('provisioning failed');
    expect(query).toHaveBeenCalledTimes(3);
  });
});
