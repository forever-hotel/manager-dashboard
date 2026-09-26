// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/auth/[action]/route';
import { backend } from '@/lib/backend';
vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
const session = {
  sub: 'id',
  username: 'manager',
  role: 'MANAGER',
  expiresAt: Math.floor(Date.now() / 1000) + 28800,
  passwordChangeRequired: false,
};
function req(
  action = 'login',
  options: {
    method?: string;
    origin?: string;
    type?: string;
    body?: string;
    cookie?: boolean;
    site?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    origin: options.origin ?? 'http://localhost:3000',
    'content-type': options.type ?? 'application/json',
  };
  if (options.cookie) headers.cookie = 'mad_session=token';
  if (options.site) headers['sec-fetch-site'] = options.site;
  return new NextRequest('http://localhost:3000/api/auth/' + action, {
    method: options.method ?? 'POST',
    headers,
    ...(options.method === 'GET' ? {} : { body: options.body ?? '{}' }),
  });
}
const context = (action: string) => ({ params: Promise.resolve({ action }) });
describe('BFF cookie/session boundary', () => {
  beforeEach(() => {
    vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
    vi.stubEnv('BACKEND_API_URL', 'http://localhost:4000');
    vi.mocked(backend).mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());
  it('stores the token only in an HttpOnly cookie and sends safe session data to the browser', async () => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...session, accessToken: 'private-token' },
    });
    const result = await POST(req(), context('login'));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(session);
    expect(result.headers.get('set-cookie')).toContain('HttpOnly');
    expect(result.headers.get('set-cookie')).toContain('SameSite=strict');
    expect(result.headers.get('cache-control')).toBe('no-store');
  });
  it('marks HTTPS cookies Secure', async () => {
    vi.stubEnv('APP_ORIGIN', 'https://mad.test');
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...session, accessToken: 'token' },
    });
    const result = await POST(
      req('login', { origin: 'https://mad.test' }),
      context('login'),
    );
    expect(result.headers.get('set-cookie')).toContain('Secure');
  });
  it.each([
    { origin: 'https://evil.test' },
    { site: 'cross-site' },
    { type: 'text/plain' },
  ])('rejects cross-origin or simple-form login %s', async (options) => {
    expect((await POST(req('login', options), context('login'))).status).toBe(
      403,
    );
    expect(backend).not.toHaveBeenCalled();
  });
  it('rejects unknown actions, absent sessions, malformed and oversized bodies', async () => {
    expect((await POST(req(), context('unknown'))).status).toBe(404);
    expect((await POST(req(), context('change-password'))).status).toBe(401);
    expect(
      (await POST(req('login', { body: 'not-json' }), context('login'))).status,
    ).toBe(400);
    expect(
      (await POST(req('login', { body: 'x'.repeat(4097) }), context('login')))
        .status,
    ).toBe(413);
  });
  it.each([400, 401, 403, 500, 503])(
    'maps upstream login error %i without leaking its body',
    async (status) => {
      vi.mocked(backend).mockResolvedValue({
        status,
        data: { password: 'secret' },
      });
      const result = await POST(req(), context('login'));
      expect(result.status).toBe(status < 500 ? status : 503);
      expect(await result.text()).not.toContain('secret');
      expect(result.cookies.get('mad_session')).toBeUndefined();
    },
  );
  it.each([{}, session, { ...session, accessToken: 1 }])(
    'fails closed for malformed success payloads',
    async (data) => {
      vi.mocked(backend).mockResolvedValue({ status: 200, data });
      expect((await POST(req(), context('login'))).status).toBe(503);
    },
  );
  it('clears a cookie after logout but retains it when revocation needs retry', async () => {
    vi.mocked(backend).mockResolvedValue({ status: 200, data: {} });
    expect(
      (
        await POST(req('logout', { cookie: true }), context('logout'))
      ).cookies.get('mad_session')?.value,
    ).toBe('');
    vi.mocked(backend).mockResolvedValue({ status: 503, data: {} });
    const failed = await POST(
      req('logout', { cookie: true }),
      context('logout'),
    );
    expect(failed.status).toBe(503);
    expect(failed.cookies.get('mad_session')).toBeUndefined();
  });
  it('returns a current safe session without exposing bearer tokens', async () => {
    vi.mocked(backend).mockResolvedValue({ status: 200, data: session });
    expect(
      await (
        await GET(
          req('session', { method: 'GET', cookie: true }),
          context('session'),
        )
      ).json(),
    ).toEqual(session);
  });
  it('rejects unauthenticated/unknown session reads', async () => {
    expect(
      (await GET(req('session', { method: 'GET' }), context('session'))).status,
    ).toBe(401);
    expect(
      (await GET(req('session', { method: 'GET' }), context('unknown'))).status,
    ).toBe(404);
  });
  it.each([401, 403, 500, 200])(
    'fails closed for invalid session response %i',
    async (status) => {
      vi.mocked(backend).mockResolvedValue({ status, data: {} });
      const result = await GET(
        req('session', { method: 'GET', cookie: true }),
        context('session'),
      );
      expect(result.status).toBe(
        status >= 500 ? 503 : status === 403 ? 403 : 401,
      );
      expect(result.cookies.get('mad_session')?.value).toBe(
        status >= 500 ? undefined : '',
      );
    },
  );
});
