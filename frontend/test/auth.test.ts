import { describe, expect, it, vi, afterEach } from 'vitest';
import { isSession, safeDestination } from '@/lib/auth';
import { httpUrl, serverConfig } from '@/lib/environment';
import { backend } from '@/lib/backend';
describe('Configuration, redirects and server transport', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  it.each([
    undefined,
    '',
    '//evil.test',
    '/\\evil.test',
    '/login',
    'https://evil.test',
    '/rooms\n',
  ])('rejects unsafe redirect %s', (value) => {
    expect(safeDestination(value)).toBe('/analytics');
  });
  it('keeps intended dashboard paths and query strings', () => {
    expect(safeDestination('/rooms?view=list')).toBe('/rooms?view=list');
  });
  it('validates session response shape and expiry', () => {
    const value = {
      sub: 'id',
      username: 'manager',
      role: 'MANAGER',
      expiresAt: Math.floor(Date.now() / 1000) + 100,
      passwordChangeRequired: false,
    };
    expect(isSession(value)).toBe(true);
    for (const change of [
      { sub: 1 },
      { username: 1 },
      { role: 'WORKER' },
      { expiresAt: 1 },
      { expiresAt: 2.5 },
      { passwordChangeRequired: undefined },
    ])
      expect(isSession({ ...value, ...change })).toBe(false);
    expect(isSession(null)).toBe(false);
    expect(isSession('string')).toBe(false);
  });
  it.each([
    undefined,
    '',
    'secret-invalid',
    'ftp://test',
    'http://user:secret@test',
    'http://test?q=x',
    'http://test#fragment',
  ])('redacts invalid URL %s', (value) => {
    expect(() => httpUrl('API_URL', value)).toThrow('Configuration: API_URL');
  });
  it('normalizes a valid URL and rejects an origin containing a path', () => {
    expect(httpUrl('API_URL', 'https://test/')).toBe('https://test');
    vi.stubEnv('APP_ORIGIN', 'http://localhost/path');
    expect(() => serverConfig()).toThrow('APP_ORIGIN');
  });
  it('forwards bearer requests without caching and maps network errors to 503', async () => {
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('BACKEND_API_URL', 'http://localhost:4000');
    vi.stubEnv('BACKEND_API_MODE', 'direct');
    const fetcher = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
    vi.stubGlobal('fetch', fetcher);
    expect(await backend('/test', 'POST', 'token', { a: 1 })).toEqual({
      status: 200,
      data: { ok: true },
    });
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:4000/test',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      }),
    );
    await backend('/health');
    fetcher.mockRejectedValue(new Error('private details'));
    expect((await backend('/test')).status).toBe(503);
  });
  it('maps auth and MAD readiness through the gateway without double-prefixing analytics', async () => {
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('BACKEND_API_URL', 'http://localhost:8080');
    vi.stubEnv('BACKEND_API_MODE', 'gateway');
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', fetcher);
    for (const [path, target] of [
      ['/auth/login', '/mad/auth/login'],
      ['/auth/session', '/mad/auth/session'],
      ['/auth/logout', '/mad/auth/logout'],
      ['/auth/change-password', '/mad/auth/change-password'],
      ['/health/ready', '/mad/health/ready'],
      ['/mad/analytics/bookings?period=week', '/mad/analytics/bookings?period=week'],
    ]) {
      await backend(path, 'GET', 'token');
      expect(fetcher).toHaveBeenLastCalledWith('http://localhost:8080' + target,
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }));
    }
  });
  it('does not treat gateway rate limits as invalid sessions', async () => {
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('BACKEND_API_URL', 'http://localhost:8080');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 429 })));
    expect((await backend('/auth/session', 'GET', 'token')).status).toBe(503);
  });
  it('rejects ambiguous backend origins and transport modes', () => {
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('BACKEND_API_URL', 'http://localhost:8080/mad');
    expect(() => serverConfig()).toThrow('BACKEND_API_URL');
    vi.stubEnv('BACKEND_API_URL', 'http://localhost:8080');
    vi.stubEnv('BACKEND_API_MODE', 'unknown');
    expect(() => serverConfig()).toThrow('BACKEND_API_MODE');
  });
});
