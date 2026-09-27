import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AuthService } from './auth.service';
import { AuthProvider } from './auth-provider';
import { TokenService } from './token.service';

describe('Central sessions and local revocation', () => {
  const secret = 'test-only-secret-with-more-than-32-characters';
  const jwt = new JwtService({ secret });
  const tokens = new TokenService(
    jwt,
    new ConfigService({ JWT_SECRET: secret, JWT_ISSUER: 'central-auth' }),
  );
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: '11111111-1111-4111-8111-111111111111',
    role: 'MANAGER',
    iss: 'central-auth',
    iat: now,
    exp: now + 28800,
  };
  const token = jwt.sign(claims);
  const state = {
    active: true,
    sub: claims.sub,
    role: 'MANAGER',
    username: 'manager',
    passwordChangeRequired: false,
  };
  let request: jest.Mock;
  let query: jest.Mock;
  let service: AuthService;
  beforeEach(() => {
    request = jest.fn().mockResolvedValue(state);
    query = jest.fn().mockResolvedValue([]);
    service = new AuthService(
      tokens,
      { request } as unknown as AuthProvider,
      { query } as unknown as DataSource,
    );
  });
  it('returns only safe session data after checking revocation and central state', async () => {
    expect(await service.session(token)).toEqual({
      sub: claims.sub,
      role: 'MANAGER',
      username: 'manager',
      expiresAt: claims.exp,
      passwordChangeRequired: false,
    });
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      expect.stringMatching(/^[a-f0-9]{64}$/),
    ]);
  });
  it('rejects local revocation without contacting the provider', async () => {
    query.mockResolvedValue([{ token_hash: 'hash' }]);
    await expect(service.session(token)).rejects.toThrow('Unauthorized');
    expect(request).not.toHaveBeenCalled();
  });
  it.each([null, [], 'invalid'])(
    'fails closed for malformed provider data %s',
    async (value) => {
      request.mockResolvedValue(value);
      await expect(service.session(token)).rejects.toThrow();
    },
  );
  it.each([{ active: false }, { sub: 'someone-else' }])(
    'rejects inactive/reset/invalid central session %s',
    async (change) => {
      request.mockResolvedValue({ ...state, ...change });
      await expect(service.session(token)).rejects.toThrow('Unauthorized');
    },
  );
  it.each([
    { role: 'WORKER' },
    { passwordChangeRequired: undefined },
    { username: undefined },
  ])('rejects disallowed or malformed state %s', async (change) => {
    request.mockResolvedValue({ ...state, ...change });
    await expect(service.session(token)).rejects.toThrow();
  });
  it('rejects a token role even if the provider incorrectly reports manager', async () => {
    await expect(
      service.session(jwt.sign({ ...claims, role: 'WORKER' })),
    ).rejects.toThrow('Forbidden');
  });
  it('restricts forced-change sessions to the password-change flow', async () => {
    request.mockResolvedValue({ ...state, passwordChangeRequired: true });
    await expect(service.session(token)).rejects.toMatchObject({
      response: { code: 'PASSWORD_CHANGE_REQUIRED' },
    });
    expect((await service.session(token, true)).passwordChangeRequired).toBe(
      true,
    );
  });
  it('accepts a login only after validating the returned token and central state', async () => {
    request
      .mockResolvedValueOnce({ accessToken: token })
      .mockResolvedValueOnce(state);
    expect(
      (await service.login({ username: 'manager', password: 'test-password' }))
        .accessToken,
    ).toBe(token);
  });
  it.each([null, {}, { accessToken: 1 }])(
    'rejects malformed login responses %s',
    async (value) => {
      request.mockResolvedValue(value);
      await expect(
        service.login({ username: 'manager', password: 'password' }),
      ).rejects.toThrow();
    },
  );
  it('revokes locally before contacting central logout, even on provider failure', async () => {
    request.mockRejectedValue(new Error('provider unavailable'));
    await expect(service.logout(token)).rejects.toThrow();
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO mad_revoked_sessions'),
      expect.any(Array),
    );
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(
      request.mock.invocationCallOrder[0],
    );
  });
  it('completes a successful logout', async () => {
    await expect(service.logout(token)).resolves.toEqual({
      status: 'signed_out',
    });
  });
  it('requires a fresh, unrestricted token after central password change', async () => {
    const fresh = jwt.sign({ ...claims, jti: 'replacement' });
    request
      .mockResolvedValueOnce(state)
      .mockResolvedValueOnce({ accessToken: fresh })
      .mockResolvedValueOnce(state);
    expect(
      (
        await service.changePassword(token, {
          currentPassword: 'old',
          newPassword: 'new',
        })
      ).accessToken,
    ).toBe(fresh);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT'),
      expect.any(Array),
    );
  });
  it.each([false, true])(
    'rejects unchanged token or incomplete password change (%s)',
    async (pending) => {
      const replacement = pending
        ? jwt.sign({ ...claims, jti: 'replacement' })
        : token;
      request
        .mockResolvedValueOnce(state)
        .mockResolvedValueOnce({ accessToken: replacement })
        .mockResolvedValueOnce({ ...state, passwordChangeRequired: pending });
      await expect(
        service.changePassword(token, {
          currentPassword: 'old',
          newPassword: 'new',
        }),
      ).rejects.toThrow();
    },
  );
});
