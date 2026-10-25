// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/settings/task-limit/route';
import { backend } from '@/lib/backend';
import { taskLimitFixture } from './task-limit-fixture';
vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
const req = (method = 'GET', body?: unknown, origin = 'http://localhost:3000', query = '', cookie = true) =>
  new NextRequest('http://localhost/api/settings/task-limit' + query, {
    method,
    headers: {
      origin,
      'content-type': 'application/json',
      ...(cookie ? { cookie: 'mad_session=private' } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
beforeEach(() => {
  vi.mocked(backend).mockReset();
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('BACKEND_API_URL', 'http://localhost:4000');
});
afterEach(() => vi.unstubAllEnvs());
describe('DDP-045 settings BFF', () => {
  it('retains an older confirmed policy while a new request is pending', async () => {
    const base = taskLimitFixture();
    const data = {
      ...base,
      limit: 2,
      version: 1,
      effectiveLimit: 3,
      effectiveVersion: 0,
      confirmedAt: base.updatedAt
    };
    vi.mocked(backend).mockResolvedValueOnce({ status: 200, data });
    expect(await (await GET(req())).json()).toEqual(data);
  });
  it('returns safe pending and confirmed policy snapshots using server-held sessions', async () => {
    const data = taskLimitFixture();
    vi.mocked(backend).mockResolvedValueOnce({
      status: 200,
      data: { ...data, private: 'secret' }
    });
    const response = await GET(req());
    expect(await response.json()).toEqual(data);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backend).toHaveBeenCalledWith('/mad/settings/task-limit', 'GET', 'private', undefined);
    vi.mocked(backend).mockResolvedValueOnce({
      status: 200,
      data: {
        ...data,
        effectiveLimit: 3,
        effectiveVersion: 0,
        confirmedAt: data.updatedAt,
        status: 'EFFECTIVE'
      }
    });
    expect((await PATCH(req('PATCH', { limit: 3, version: 0 }))).status).toBe(200);
  });
  it('rejects invalid input, absent sessions, query fields and CSRF before forwarding', async () => {
    expect((await GET(req('GET', undefined, 'http://localhost:3000', '', false))).status).toBe(401);
    expect((await GET(req('GET', undefined, 'http://localhost:3000', '?extra=1'))).status).toBe(400);
    expect((await PATCH(req('PATCH', { limit: 2, version: 0 }, 'https://bad.invalid'))).status).toBe(403);
    for (const body of [
      { limit: 0, version: 0 },
      { limit: 11, version: 0 },
      { limit: 1.5, version: 0 },
      { limit: '3', version: 0 },
      { limit: null, version: 0 },
      { limit: 2 },
      { limit: 2, version: 0, extra: 1 }
    ])
      expect((await PATCH(req('PATCH', body))).status).toBe(400);
    expect((await PATCH(req('PATCH', { extra: 'x'.repeat(3000) }))).status).toBe(413);
    expect(
      (
        await PATCH(
          new NextRequest('http://localhost/api/settings/task-limit', {
            method: 'PATCH',
            headers: {
              cookie: 'mad_session=private',
              origin: 'http://localhost:3000',
              'content-type': 'application/json'
            },
            body: '{'
          })
        )
      ).status
    ).toBe(400);
    expect(backend).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 409, 500, 503])('sanitizes upstream status %s', async status => {
    vi.mocked(backend).mockResolvedValueOnce({
      status,
      data: { private: 'secret' }
    });
    const response = await GET(req());
    expect(response.status).toBe(status >= 500 ? 503 : status);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
  it('rejects invented effectiveness, inconsistent acknowledgements and wrong cohorts', async () => {
    const data = taskLimitFixture();
    for (const source of [
      {},
      { ...data, status: 'EFFECTIVE' },
      { ...data, effectiveLimit: 3 },
      {
        ...data,
        effectiveVersion: 1,
        effectiveLimit: 3,
        confirmedAt: data.updatedAt
      },
      {
        ...data,
        effectiveVersion: 0,
        effectiveLimit: 2,
        confirmedAt: data.updatedAt,
        status: 'EFFECTIVE'
      },
      { ...data, activeStates: ['ASSIGNED', 'IN_PROGRESS'] }
    ]) {
      vi.mocked(backend).mockResolvedValueOnce({ status: 200, data: source });
      expect((await GET(req())).status).toBe(503);
    }
  });
});
