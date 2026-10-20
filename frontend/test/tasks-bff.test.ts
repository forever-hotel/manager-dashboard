// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/tasks/route';
import { POST } from '@/app/api/realtime/ticket/route';
import { backend } from '@/lib/backend';
import { tasksSnapshot } from './tasks-fixture';
vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
const req = (query = '', cookie = true, origin = 'http://localhost:3000') =>
  new NextRequest('http://localhost/api/tasks?' + query, {
    headers: { origin, ...(cookie ? { cookie: 'mad_session=private' } : {}) },
  });
beforeEach(() => {
  vi.mocked(backend).mockReset();
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('BACKEND_API_URL', 'http://localhost:4000');
  vi.stubEnv('MAD_SOCKET_PUBLIC_URL', 'http://localhost:4000');
});
afterEach(() => vi.unstubAllEnvs());
describe('DDP-028 protected task routes', () => {
  it('forwards validated filters with the session server-side and strips unknown fields', async () => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...tasksSnapshot(), private: 'secret' },
    });
    const response = await GET(req('status=ASSIGNED'));
    expect(await response.json()).toEqual(tasksSnapshot());
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backend).toHaveBeenCalledWith(
      '/mad/tasks?page=1&pageSize=20&status=ASSIGNED',
      'GET',
      'private',
    );
  });
  it('rejects invalid inputs and absent auth before upstream access', async () => {
    expect((await GET(req('', false))).status).toBe(401);
    for (const query of [
      'extra=1',
      'page=1&page=2',
      'status=NEW',
      'worker=bad',
      'worker=',
      'page=0',
      'pageSize=101',
      'pageSize=',
      'page=x',
      'page=100001',
    ])
      expect((await GET(req(query))).status).toBe(400);
    expect(backend).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 500, 503])(
    'sanitizes upstream status %s',
    async (status) => {
      vi.mocked(backend).mockResolvedValue({
        status,
        data: { private: 'secret' },
      });
      const response = await GET(req());
      expect(response.status).toBe([401, 403].includes(status) ? status : 503);
      expect(JSON.stringify(await response.json())).not.toContain('secret');
      expect((await POST(req())).status).toBe(
        [401, 403].includes(status) ? status : 503,
      );
    },
  );
  it('rejects malformed snapshots and page mismatches', async () => {
    for (const data of [{}, { ...tasksSnapshot(), page: 2 }]) {
      vi.mocked(backend).mockResolvedValue({ status: 200, data });
      expect((await GET(req())).status).toBe(503);
    }
  });
  it('issues a short-lived socket ticket without exposing the login token', async () => {
    expect((await POST(req('', true, 'http://untrusted'))).status).toBe(403);
    expect((await POST(req('', false))).status).toBe(401);
    vi.mocked(backend).mockResolvedValue({
      status: 201,
      data: { ticket: 'a'.repeat(43) },
    });
    const result = await POST(req());
    expect(await result.json()).toEqual({
      ticket: 'a'.repeat(43),
      socketUrl: 'http://localhost:4000',
    });
    expect(backend).toHaveBeenCalledWith(
      '/mad/realtime/ticket',
      'POST',
      'private',
    );
    vi.stubEnv('MAD_SOCKET_PUBLIC_URL', 'invalid');
    expect((await POST(req())).status).toBe(503);
    vi.stubEnv('MAD_SOCKET_PUBLIC_URL', 'http://localhost:4000/path');
    expect((await POST(req())).status).toBe(503);
  });
});
