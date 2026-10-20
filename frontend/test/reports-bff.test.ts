// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/reports/[type]/route';
import { reportResponse, csv } from './report-fixture';
const ctx = (type = 'bookings') => ({ params: Promise.resolve({ type }) });
const req = (
  query = 'format=csv&period=week',
  cookie = true,
  origin?: string,
) =>
  new NextRequest('http://localhost:3000/api/reports/bookings?' + query, {
    headers: {
      ...(cookie ? { cookie: 'mad_session=secret-token' } : {}),
      ...(origin ? { origin } : {}),
    },
  });
let upstream: ReturnType<typeof vi.fn>;
beforeEach(() => {
  upstream = vi.fn(async () => reportResponse());
  vi.stubGlobal('fetch', upstream);
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('BACKEND_API_URL', 'http://localhost:8080');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe('DDP-031 binary report proxy', () => {
  it('keeps authentication server-side and forwards validated filters and binary headers', async () => {
    const response = await GET(req(), ctx());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(csv.replace(/^\ufeff/, ''));
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="bookings-2026-10-21.csv"',
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(upstream).toHaveBeenCalledWith(
      'http://localhost:8080/mad/reports/bookings?format=csv&period=week',
      expect.objectContaining({
        headers: { Authorization: 'Bearer secret-token' },
        redirect: 'error',
      }),
    );
  });
  it('returns valid PDF data', async () => {
    upstream.mockResolvedValueOnce(reportResponse('pdf'));
    const response = await GET(req('format=pdf'), ctx());
    expect(response.status).toBe(200);
    expect((await response.text()).startsWith('%PDF-')).toBe(true);
  });
  it('rejects absent sessions, cross-origin access and invalid filters before upstream access', async () => {
    expect((await GET(req('', false), ctx())).status).toBe(401);
    expect(
      (await GET(req('format=csv', true, 'http://evil'), ctx())).status,
    ).toBe(403);
    for (const query of [
      'format=xls',
      'format=csv&period=year',
      'format=csv&extra=1',
      'format=csv&format=pdf',
    ])
      expect((await GET(req(query), ctx())).status).toBe(400);
    expect((await GET(req(), ctx('bad'))).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 422, 429, 500])(
    'sanitizes upstream status %s',
    async (status) => {
      upstream.mockResolvedValueOnce(new Response('private SQL', { status }));
      const response = await GET(req(), ctx());
      expect(response.status).toBe([429, 500].includes(status) ? 503 : status);
      expect(await response.text()).not.toContain('private');
    },
  );
  it('never proxies corrupt or oversized files as successful downloads', async () => {
    for (const response of [
      new Response('<html>error</html>', {
        headers: { 'Content-Type': 'text/html' },
      }),
      new Response('bad', {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="../bad.csv"',
        },
      }),
      new Response('bad', {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition':
            'attachment; filename="bookings-2026-10-21.csv"',
        },
      }),
      new Response('bad', {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Length': '9000000',
          'Content-Disposition':
            'attachment; filename="bookings-2026-10-21.csv"',
        },
      }),
    ]) {
      upstream.mockResolvedValueOnce(response);
      expect((await GET(req(), ctx())).status).toBe(503);
    }
  });
});
