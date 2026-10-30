// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/notifications/[[...path]]/route';
import { backend } from '@/lib/backend';
import { notificationsFixture, notificationId } from './notifications-fixture';

vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
const context = (path: string[] = []) => ({
  params: Promise.resolve({ path })
});
const request = (query = '', cookie = true) =>
  new NextRequest('http://localhost/api/notifications' + query, {
    headers: cookie ? { cookie: 'mad_session=private' } : {}
  });
const patch = (body: unknown = { revision: 'SUBMITTED:0' }, origin = 'http://localhost:3000', query = '') =>
  new NextRequest('http://localhost/api/notifications/COMPLAINT/' + notificationId + '/read' + query, {
    method: 'PATCH',
    headers: {
      cookie: 'mad_session=private',
      origin,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
beforeEach(() => {
  vi.mocked(backend).mockReset();
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('BACKEND_API_URL', 'http://localhost:4000');
});
afterEach(() => vi.unstubAllEnvs());
describe('DDP-043 notification BFF', () => {
  it('forwards the server session, validates snapshots and strips extra source fields', async () => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...notificationsFixture(), private: 'hidden' }
    });
    const response = await GET(request(), context());

    expect(await response.json()).toEqual(notificationsFixture());
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backend).toHaveBeenCalledWith('/mad/notifications?page=1&pageSize=20', 'GET', 'private', undefined);
  });
  it('rejects missing sessions, unknown/repeated queries, invalid paging and paths before upstream access', async () => {
    expect((await GET(request('', false), context())).status).toBe(401);
    for (const query of [
      '?extra=1',
      '?page=1&page=2',
      '?page=0',
      '?page=1e2',
      '?page=100001',
      '?pageSize=0',
      '?pageSize=101',
      '?pageSize=1.0'
    ])
      expect((await GET(request(query), context())).status).toBe(400);
    expect((await GET(request(), context(['bad']))).status).toBe(404);
    expect(backend).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 409, 500, 503])('sanitizes upstream failure %s', async status => {
    vi.mocked(backend).mockResolvedValue({
      status,
      data: { private: 'secret' }
    });
    const response = await GET(request(), context());

    expect(response.status).toBe(status >= 500 ? 503 : status);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
  it('rejects inconsistent counts, duplicates, forged links and page mismatches', async () => {
    const data = notificationsFixture();

    for (const source of [
      {},
      { ...data, total: 0 },
      { ...data, page: 2 },
      { ...data, items: [data.items[0], data.items[0]] },
      {
        ...data,
        items: [{ ...data.items[0], href: 'https://evil.invalid' }, data.items[1]]
      }
    ]) {
      vi.mocked(backend).mockResolvedValue({ status: 200, data: source });
      expect((await GET(request(), context())).status).toBe(503);
    }
  });
  it('requires same-origin JSON and a current revision to mark read', async () => {
    const target = context(['COMPLAINT', notificationId, 'read']);

    expect((await PATCH(patch({}, 'https://untrusted.invalid'), target)).status).toBe(403);
    expect((await PATCH(patch({}), target)).status).toBe(400);
    expect((await PATCH(patch({ revision: 'SUBMITTED:0', resolve: true }), target)).status).toBe(400);
    expect((await PATCH(patch({ revision: 'SUBMITTED:0' }, 'http://localhost:3000', '?page=1'), target)).status).toBe(
      400
    );
    expect((await PATCH(patch({ revision: 'x'.repeat(3000) }), target)).status).toBe(413);
    expect(backend).not.toHaveBeenCalled();
    vi.mocked(backend).mockResolvedValueOnce({
      status: 200,
      data: { read: true }
    });
    expect((await PATCH(patch(), target)).status).toBe(200);
    expect(backend).toHaveBeenLastCalledWith(
      '/mad/notifications/COMPLAINT/' + notificationId + '/read',
      'PATCH',
      'private',
      { revision: 'SUBMITTED:0' }
    );
    vi.mocked(backend).mockResolvedValueOnce({ status: 200, data: {} });
    expect((await PATCH(patch(), target)).status).toBe(503);
  });
});
