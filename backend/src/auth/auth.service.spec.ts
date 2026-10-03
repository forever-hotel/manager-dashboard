import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource, EntityManager } from 'typeorm';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { hashPassword, verifyPassword } from './password';
jest.mock('./password', () => ({
  verifyPassword: jest.fn(),
  hashPassword: jest.fn(),
  validPassword: (value: string) => value.length >= 12 && value.length <= 1024,
}));

describe('Manager-owned authentication', () => {
  const jwt = new JwtService();
  const tokens = new TokenService(jwt, new ConfigService({
    JWT_SECRET: 'test-only-secret-with-more-than-32-characters', JWT_ISSUER: 'mad',
  }));
  const account = {
    worker_id: '11111111-1111-4111-8111-111111111111',
    username: 'manager', role: 'MANAGER', is_active: true, password_hash: 'stored',
    password_change_required: false, session_version: 0,
    failed_attempts: 0, locked_until: null as Date | null,
  };
  let query: jest.Mock;
  let service: AuthService;
  beforeEach(() => {
    query = jest.fn().mockResolvedValue([account]);
    const database = {
      query,
      transaction: (work: (manager: EntityManager) => unknown) =>
        work({ query } as unknown as EntityManager),
    } as unknown as DataSource;
    service = new AuthService(tokens, database);
    jest.mocked(verifyPassword).mockReset().mockResolvedValue(true);
    jest.mocked(hashPassword).mockReset().mockResolvedValue('new-hash');
  });
  it('issues a safe session using a normalized local username', async () => {
    const result = await service.login({ username: ' Manager ', password: 'local-password' });
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining('FOR UPDATE'), ['manager']);
    expect(result).toMatchObject({ username: 'manager', role: 'MANAGER', passwordChangeRequired: false });
    expect(result).not.toHaveProperty('password_hash');
    expect(tokens.verify(result.accessToken)).toMatchObject({ sub: account.worker_id, ver: 0 });
  });
  it.each([
    undefined, { ...account, is_active: false },
    { ...account, locked_until: new Date(Date.now() + 60000) },
  ])('rejects unknown, inactive and locked accounts', async (row) => {
    query.mockResolvedValueOnce(row ? [row] : []);
    await expect(service.login({ username: 'manager', password: 'wrong' })).rejects.toThrow('Unauthorized');
    expect(verifyPassword).toHaveBeenCalled();
  });
  it('persists failed-login counters and locks after five guesses', async () => {
    query.mockResolvedValueOnce([{ ...account, failed_attempts: 4 }]);
    jest.mocked(verifyPassword).mockResolvedValue(false);
    await expect(service.login({ username: 'manager', password: 'wrong' })).rejects.toThrow('Unauthorized');
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('15 minutes'), [account.worker_id, 5]);
  });
  it('starts a fresh counter after an expired lockout', async () => {
    query.mockResolvedValueOnce([{ ...account, failed_attempts: 5, locked_until: new Date(0) }]);
    jest.mocked(verifyPassword).mockResolvedValue(false);
    await expect(service.login({ username: 'manager', password: 'wrong' })).rejects.toThrow();
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [account.worker_id, 1]);
  });
  it('returns only public fields from an active, unrevoked account', async () => {
    const token = tokens.issue(account.worker_id, 0);
    const session = await service.session(token);
    expect(session).not.toHaveProperty('password_hash');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('NOT EXISTS'),
      [account.worker_id, expect.stringMatching(/^[a-f0-9]{64}$/)]);
  });
  it.each([undefined, { ...account, is_active: false }, { ...account, session_version: 1 }])(
    'rejects revoked, inactive or superseded sessions', async (row) => {
      query.mockResolvedValue(row ? [row] : []);
      await expect(service.session(tokens.issue(account.worker_id, 0))).rejects.toThrow('Unauthorized');
    },
  );
  it('enforces password change before business access', async () => {
    query.mockResolvedValue([{ ...account, password_change_required: true }]);
    const token = tokens.issue(account.worker_id, 0);
    await expect(service.session(token)).rejects.toThrow('Change your password');
    expect((await service.session(token, true)).passwordChangeRequired).toBe(true);
  });
  it('rejects signed non-manager tokens', async () => {
    const token = jwt.sign({
      sub: account.worker_id, ver: 0, role: 'WORKER',
      jti: '22222222-2222-4222-8222-222222222222',
    }, { secret: 'test-only-secret-with-more-than-32-characters',
      issuer: 'mad', audience: 'mad', expiresIn: '8h' });
    await expect(service.session(token)).rejects.toThrow('Forbidden');
    await expect(service.logout(token)).rejects.toThrow('Forbidden');
  });
  it('rotates the password and all previous session versions atomically', async () => {
    const token = tokens.issue(account.worker_id, 0);
    query.mockResolvedValueOnce([account]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...account, session_version: 1 }]);
    const result = await service.changePassword(token, {
      currentPassword: 'old-password', newPassword: 'replacement-password',
    });
    expect(result.accessToken).not.toBe(token);
    expect(tokens.verify(result.accessToken).ver).toBe(1);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('session_version=session_version+1'),
      [account.worker_id, 'new-hash']);
  });
  it('commits wrong-current-password counters without changing the hash', async () => {
    query.mockResolvedValueOnce([account]).mockResolvedValueOnce([]);
    jest.mocked(verifyPassword).mockResolvedValue(false);
    await expect(service.changePassword(tokens.issue(account.worker_id, 0), {
      currentPassword: 'wrong', newPassword: 'replacement-password',
    })).rejects.toThrow('Unauthorized');
    expect(hashPassword).not.toHaveBeenCalled();
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('failed_attempts'), [account.worker_id, 1]);
  });
  it.each([
    { currentPassword: 'old', newPassword: 'short' },
    { currentPassword: 'same-password', newPassword: 'same-password' },
  ])('rejects unacceptable password changes', async (body) => {
    await expect(service.changePassword(tokens.issue(account.worker_id, 0), body)).rejects.toThrow('12 to 1024');
    expect(query).not.toHaveBeenCalled();
  });
  it('refuses revoked sessions during password change', async () => {
    query.mockResolvedValueOnce([account]).mockResolvedValueOnce([{ token_hash: 'revoked' }]);
    await expect(service.changePassword(tokens.issue(account.worker_id, 0), {
      currentPassword: 'old-password', newPassword: 'replacement-password',
    })).rejects.toThrow('Unauthorized');
  });
  it('durably revokes logout without an external provider', async () => {
    expect(await service.logout(tokens.issue(account.worker_id, 0))).toEqual({ status: 'signed_out' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT DO NOTHING'),
      [expect.stringMatching(/^[a-f0-9]{64}$/), expect.any(Number)]);
  });
  it('propagates database failure rather than accepting a session', async () => {
    query.mockRejectedValue(new Error('database offline'));
    await expect(service.session(tokens.issue(account.worker_id, 0))).rejects.toThrow('Service Unavailable');
  });
});
