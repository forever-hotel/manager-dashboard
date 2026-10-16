// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PUT, DELETE } from '@/app/api/promotions/[[...path]]/route';
import { backend } from '@/lib/backend';
import { page, promotion, room } from './promotions-fixture';
import { formFrom, formPayload } from '@/lib/promotions';
vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
vi.mock('@/lib/environment', () => ({
  serverConfig: () => ({ origin: 'http://localhost' }),
}));
const context = (path: string[] = []) => ({
  params: Promise.resolve({ path }),
});
function req(
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
  query = '',
) {
  return new NextRequest('http://localhost/api/promotions' + query, {
    method,
    headers: {
      cookie: 'mad_session=private',
      origin: 'http://localhost',
      'content-type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
describe('DDP-020 protected promotion BFF', () => {
  beforeEach(() => vi.mocked(backend).mockReset());
  it('lists promotions and strips unrecognized data', async () => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: page([{ ...promotion(), secret: 'hidden' }]),
    });
    const response = await GET(
      req('GET', undefined, {}, '?page=2&pageSize=20'),
      context(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(page([promotion()]));
    expect(backend).toHaveBeenCalledWith(
      '/mad/promotions?page=2&pageSize=20',
      'GET',
      'private',
      undefined,
    );
  });
  it.each(['room-types', promotion().id])('reads %s', async (path) => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: path === 'room-types' ? page([room]) : promotion(),
    });
    expect((await GET(req(), context([path]))).status).toBe(200);
  });
  it.each([
    ['POST', [], { ...formPayload(formFrom(promotion())), status: 'INACTIVE' }],
    [
      'PUT',
      [promotion().id],
      { ...formPayload(formFrom(promotion())), version: 0 },
    ],
    ['POST', [promotion().id, 'activate'], { version: 0 }],
    ['POST', [promotion().id, 'deactivate'], { version: 0 }],
    ['DELETE', [promotion().id], { version: 0 }],
  ] as const)(
    'forwards allowed %s %j through the server-held token',
    async (method, path, body) => {
      vi.mocked(backend).mockResolvedValue({ status: 200, data: promotion() });
      const handler =
        method === 'PUT' ? PUT : method === 'DELETE' ? DELETE : POST;
      expect(
        (await handler(req(method, body), context([...path]))).status,
      ).toBe(200);
      expect(backend).toHaveBeenCalledWith(
        '/mad/promotions' + (path.length ? '/' + path.join('/') : ''),
        method,
        'private',
        body,
      );
    },
  );
  it.each([400, 401, 403, 404, 409, 500, 503])(
    'sanitizes upstream failure %s',
    async (status) => {
      vi.mocked(backend).mockResolvedValue({
        status,
        data: { message: 'secret database error' },
      });
      const response = await DELETE(
        req('DELETE', { version: 0 }),
        context([promotion().id]),
      );
      expect(response.status).toBe(status >= 500 ? 503 : status);
      expect(JSON.stringify(await response.json())).not.toContain('secret');
    },
  );
  it('blocks missing sessions, cross-site mutations, invalid origin and content type', async () => {
    expect(
      (await GET(req('GET', undefined, { cookie: '' }), context())).status,
    ).toBe(401);
    for (const headers of [
      { origin: 'https://attacker.invalid' },
      { 'sec-fetch-site': 'cross-site' },
      { 'content-type': 'text/plain' },
    ] as Record<string, string>[])
      expect((await POST(req('POST', {}, headers), context())).status).toBe(
        403,
      );
    expect(backend).not.toHaveBeenCalled();
  });
  it('rejects invalid paths, verbs, pagination, queries and bodies without forwarding', async () => {
    expect((await GET(req(), context(['..', 'auth']))).status).toBe(404);
    expect((await PUT(req('PUT', {}), context())).status).toBe(404);
    for (const query of [
      '?page=0',
      '?page=1000001',
      '?pageSize=101',
      '?page=1&page=2',
      '?extra=1',
    ])
      expect(
        (await GET(req('GET', undefined, {}, query), context())).status,
      ).toBe(400);
    expect(
      (
        await GET(
          req('GET', undefined, {}, '?page=1'),
          context([promotion().id]),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(req('POST', {}, {}, '?extra=1'), context())).status,
    ).toBe(400);
    for (const body of [{}, { version: -1 }, { version: 0, status: 'ACTIVE' }])
      expect(
        (await DELETE(req('DELETE', body), context([promotion().id]))).status,
      ).toBe(400);
    expect(
      (await POST(req('POST', { huge: 'a'.repeat(17000) }), context())).status,
    ).toBe(413);
    expect(backend).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON and invalid upstream successes', async () => {
    const bad = new NextRequest('http://localhost/api/promotions', {
      method: 'POST',
      headers: {
        cookie: 'mad_session=x',
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: '{',
    });
    expect((await POST(bad, context())).status).toBe(400);
    vi.mocked(backend).mockResolvedValue({ status: 200, data: {} });
    expect((await GET(req(), context())).status).toBe(503);
  });
});
