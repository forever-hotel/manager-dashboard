import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
describe('Gateway authentication adapter', () => {
  const service = new AuthService(new ConfigService({ AUTH_SERVICE_URL: 'http://gateway.test' }));
  const session = {
    sub: '11111111-1111-4111-8111-111111111111',
    username: 'manager',
    role: 'MANAGER',
    expiresAt: 4102444800,
    passwordChangeRequired: false
  };
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });
  function response(body: unknown, status = 200) {
    global.fetch = jest.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  }
  it('delegates JWT validation and checks the manager session', async () => {
    response(session);
    expect(await service.session('opaque-token')).toEqual(session);
    const [url, init] = (fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://gateway.test/mad/auth/session');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer opaque-token');
  });
  it('blocks non-manager sessions', async () => {
    response({ ...session, role: 'WORKER' });
    await expect(service.session('token')).rejects.toMatchObject({ status: 403 });
  });
  it('blocks first-login dashboard access but allows password changes', async () => {
    response({ ...session, passwordChangeRequired: true });
    await expect(service.session('token')).rejects.toMatchObject({ status: 403 });
    await expect(service.session('token', true)).resolves.toMatchObject({ passwordChangeRequired: true });
  });
  it.each([null, {}, { ...session, expiresAt: 0 }, { ...session, sub: 'bad' }])(
    'fails closed on malformed sessions',
    async body => {
      response(body);
      await expect(service.session('token')).rejects.toMatchObject({ status: 503 });
    }
  );
  it.each([400, 401, 403, 503])('preserves authentication failures: %s', async status => {
    response({}, status);
    await expect(service.session('token')).rejects.toMatchObject({ status });
  });
  it('fails closed on network errors', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('private'));
    await expect(service.session('token')).rejects.toMatchObject({ status: 503 });
  });
  it('forwards login, change and logout', async () => {
    response({ status: 'ok' });
    await service.login({ username: 'manager', password: 'private' });
    await service.changePassword('token', { currentPassword: 'old', newPassword: 'new' });
    await service.logout('token');
    expect(fetch).toHaveBeenLastCalledWith(
      'http://gateway.test/mad/auth/logout',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
