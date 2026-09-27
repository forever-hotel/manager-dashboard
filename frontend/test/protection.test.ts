// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { backend } from '@/lib/backend';
import { requireSession } from '@/lib/session';
import { cookies } from 'next/headers';
vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
const session = {
  sub: 'id',
  username: 'manager',
  role: 'MANAGER',
  expiresAt: Math.floor(Date.now() / 1000) + 28800,
  passwordChangeRequired: false,
};
const request = (path = '/rooms', token = true) =>
  new NextRequest('http://localhost:3000' + path, {
    headers: token ? { cookie: 'mad_session=token' } : {},
  });
describe('Protected navigation', () => {
  beforeEach(() => vi.mocked(backend).mockReset());
  it.each(['/', '/login', '/unavailable'])('allows public %s', async (path) => {
    expect((await proxy(request(path, false))).status).toBe(200);
    expect(backend).not.toHaveBeenCalled();
  });
  it('redirects direct links without a session and preserves the destination', async () => {
    const result = await proxy(request('/rooms?view=list', false));
    expect(result.headers.get('location')).toContain(
      '/login?next=%2Frooms%3Fview%3Dlist',
    );
  });
  it.each([401, 403, 200])(
    'clears rejected/invalid sessions (%i)',
    async (status) => {
      vi.mocked(backend).mockResolvedValue({ status, data: {} });
      const result = await proxy(request());
      expect(result.headers.get('location')).toContain('reason=expired');
      expect(result.cookies.get('mad_session')?.value).toBe('');
    },
  );
  it('reports provider unavailability without displaying dashboard content', async () => {
    vi.mocked(backend).mockResolvedValue({ status: 503, data: {} });
    expect((await proxy(request())).headers.get('location')).toContain(
      '/unavailable',
    );
  });
  it('restricts forced-change sessions while allowing the password form', async () => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...session, passwordChangeRequired: true },
    });
    expect((await proxy(request())).headers.get('location')).toContain(
      '/change-password',
    );
    expect((await proxy(request('/change-password'))).status).toBe(200);
  });
  it('allows valid sessions with private no-store caching', async () => {
    vi.mocked(backend).mockResolvedValue({ status: 200, data: session });
    expect((await proxy(request())).headers.get('cache-control')).toBe(
      'private, no-store',
    );
  });
  function cookie(token = true) {
    vi.mocked(cookies).mockResolvedValue({
      get: () => (token ? { value: 'token' } : undefined),
    } as unknown as Awaited<ReturnType<typeof cookies>>);
  }
  it('also checks authentication at the server layout boundary', async () => {
    cookie(false);
    await expect(requireSession()).rejects.toThrow('/login');
    cookie();
    vi.mocked(backend).mockResolvedValue({ status: 503, data: {} });
    await expect(requireSession()).rejects.toThrow('/unavailable');
    vi.mocked(backend).mockResolvedValue({ status: 401, data: {} });
    await expect(requireSession()).rejects.toThrow('/login?reason=expired');
    vi.mocked(backend).mockResolvedValue({ status: 200, data: {} });
    await expect(requireSession()).rejects.toThrow('/login?reason=expired');
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...session, passwordChangeRequired: true },
    });
    await expect(requireSession()).rejects.toThrow('/change-password');
    await expect(requireSession(true)).resolves.toMatchObject({
      passwordChangeRequired: true,
    });
    vi.mocked(backend).mockResolvedValue({ status: 200, data: session });
    await expect(requireSession()).resolves.toEqual(session);
  });
});
