import { ConfigService } from '@nestjs/config';
import { AuthProvider } from './auth-provider';
describe('Central auth HTTP adapter', () => {
  const provider = new AuthProvider(
    new ConfigService({ AUTH_SERVICE_URL: 'https://auth.example.test/' }),
  );
  afterEach(() => jest.restoreAllMocks());
  it('sends credentials to the configured provider with no caching and a timeout', async () => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"accessToken":"test"}'));
    await expect(
      provider.request('/auth/login', 'POST', undefined, {
        username: 'manager',
        password: 'password',
      }),
    ).resolves.toEqual({ accessToken: 'test' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://auth.example.test/auth/login',
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'error',
        signal: expect.any(AbortSignal) as AbortSignal,
      }),
    );
  });
  it('sends bearer sessions and accepts no-content responses', async () => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await expect(
      provider.request('/auth/logout', 'POST', 'token'),
    ).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
        }) as Record<string, string>,
      }),
    );
  });
  it.each([
    [400, 400],
    [401, 401],
    [403, 403],
    [429, 503],
    [500, 503],
  ])('maps upstream %i safely', async (upstream, expected) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response('private provider error', { status: upstream }),
      );
    await expect(
      provider.request('/auth/session', 'GET'),
    ).rejects.toMatchObject({ status: expected });
  });
  it('redacts network failures and malformed responses', async () => {
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('secret connection string'));
    await expect(provider.request('/auth/session', 'GET')).rejects.toThrow(
      'Service Unavailable',
    );
    fetcher.mockResolvedValue(new Response('not JSON'));
    await expect(provider.request('/auth/session', 'GET')).rejects.toThrow(
      'Service Unavailable',
    );
  });
});
