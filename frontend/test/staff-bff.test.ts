// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PATCH } from '@/app/api/staff/[[...path]]/route';
import { backend } from '@/lib/backend';
import {
  staffFixture,
  staffPageFixture,
  staffId,
  staffInputFixture,
} from './staff-fixture';
vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
const context = (path: string[] = []) => ({
  params: Promise.resolve({ path }),
});
const req = (
  method = 'GET',
  body?: unknown,
  query = '',
  cookie = true,
  origin = 'http://localhost:3000',
) =>
  new NextRequest('http://localhost:3000/api/staff' + query, {
    method,
    headers: {
      'Content-Type': 'application/json',
      origin,
      ...(cookie ? { cookie: 'mad_session=private' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeEach(() => {
  vi.mocked(backend).mockReset();
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('BACKEND_API_URL', 'http://localhost:4000');
});
afterEach(() => vi.unstubAllEnvs());
describe('DDP-029 staff proxy', () => {
  it('projects safe directory/detail responses and keeps the token server-side', async () => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...staffPageFixture(), password: 'secret' },
    });
    const response = await GET(req(), context());
    expect(await response.json()).toEqual(staffPageFixture());
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backend).toHaveBeenCalledWith(
      '/mad/staff?page=1&pageSize=20',
      'GET',
      'private',
      undefined,
    );
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...staffFixture(), password_hash: 'secret' },
    });
    expect(await (await GET(req(), context([staffId]))).json()).toEqual(
      staffFixture(),
    );
  });
  it('validates create, edit and versioned reset contracts', async () => {
    vi.mocked(backend).mockResolvedValue({
      status: 201,
      data: {
        staffId,
        deliveryId: staffId,
        deliveryStatus: 'pending',
        password: 'secret',
      },
    });
    const response = await POST(req('POST', staffInputFixture()), context());
    expect(response.status).toBe(201);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
    vi.mocked(backend).mockResolvedValue({ status: 200, data: staffFixture() });
    expect(
      (
        await PATCH(
          req('PATCH', { version: 0, name: 'New' }),
          context([staffId]),
        )
      ).status,
    ).toBe(200);
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { staffId, deliveryId: staffId, deliveryStatus: 'pending' },
    });
    expect(
      (
        await POST(
          req('POST', { version: 0 }),
          context([staffId, 'reset-password']),
        )
      ).status,
    ).toBe(200);
  });
  it('rejects missing sessions, cross-origin writes, invalid paths and malformed payloads', async () => {
    expect(
      (await GET(req('GET', undefined, '', false), context())).status,
    ).toBe(401);
    expect(
      (
        await POST(
          req('POST', staffInputFixture(), '', true, 'http://evil'),
          context(),
        )
      ).status,
    ).toBe(403);
    expect((await GET(req(), context(['bad']))).status).toBe(404);
    for (const query of [
      '?page=0',
      '?role=MANAGER',
      '?extra=1',
      '?page=1&page=2',
      '?page=1e2',
      '?page=0x10',
      '?pageSize=1.0',
      '?search=bad%00value',
    ])
      expect((await GET(req('GET', undefined, query), context())).status).toBe(
        400,
      );
    expect(
      (await GET(req('GET', undefined, '?page=1'), context([staffId]))).status,
    ).toBe(400);
    expect((await POST(req('POST', {}), context())).status).toBe(400);
    expect(
      (await POST(req('POST', {}), context([staffId, 'reset-password'])))
        .status,
    ).toBe(400);
    expect(
      (
        await PATCH(
          req('PATCH', { version: 0, isActive: true }),
          context([staffId]),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(req('POST', { name: 'x'.repeat(17000) }), context())).status,
    ).toBe(413);
    expect(backend).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 409, 500])(
    'sanitizes upstream errors %s',
    async (status) => {
      vi.mocked(backend).mockResolvedValue({
        status,
        data: { password: 'secret' },
      });
      const response = await GET(req(), context());
      expect(response.status).toBe(status === 500 ? 503 : status);
      expect(JSON.stringify(await response.json())).not.toContain('secret');
    },
  );
  it('rejects malformed success data', async () => {
    vi.mocked(backend).mockResolvedValue({ status: 200, data: {} });
    expect((await GET(req(), context())).status).toBe(503);
  });
  it('rejects duplicate/incomplete pages and mismatched IDs, filters or pagination', async () => {
    for (const data of [
      { ...staffPageFixture(), total: 2 },
      {
        ...staffPageFixture(),
        total: 2,
        items: [staffFixture(), staffFixture()],
      },
      { ...staffPageFixture(), page: 2, items: [] },
      { ...staffPageFixture(), pageSize: 10 },
      { ...staffPageFixture(), total: 9007199254740992 },
    ]) {
      vi.mocked(backend).mockResolvedValue({ status: 200, data });
      expect((await GET(req(), context())).status).toBe(503);
    }
    vi.mocked(backend).mockResolvedValue({ status: 200, data: staffFixture() });
    expect(
      (await GET(req(), context(['77f4568c-89ab-4c12-b321-123456789012'])))
        .status,
    ).toBe(503);
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: staffPageFixture(),
    });
    expect(
      (
        await GET(
          req('GET', undefined, '?role=WORKER&status=active'),
          context(),
        )
      ).status,
    ).toBe(200);
    for (const query of ['?role=RECEPTIONIST', '?status=inactive'])
      expect((await GET(req('GET', undefined, query), context())).status).toBe(
        503,
      );
  });
});
