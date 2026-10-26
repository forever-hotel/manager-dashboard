// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/analytics/route';
import { backend } from '@/lib/backend';
import { overview } from './analytics-fixture';
vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
const req = (query = 'period=week', cookie = true) =>
  new NextRequest('http://localhost/api/analytics?' + query, {
    headers: cookie ? { cookie: 'mad_session=private-token' } : {}
  });
describe('DDP-015 protected analytics BFF', () => {
  beforeEach(() => vi.mocked(backend).mockReset());
  it('forwards the cookie server-side and returns only validated fields', async () => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...overview(), private: 'secret' }
    });
    const result = await GET(req());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(overview());
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(backend).toHaveBeenCalledWith('/mad/analytics/overview?period=week', 'GET', 'private-token');
  });
  it('rejects absent auth and invalid query input without calling upstream', async () => {
    expect((await GET(req('period=week', false))).status).toBe(401);
    for (const query of ['', 'period=year', 'period=day&period=week', 'period=day&extra=1'])
      expect((await GET(req(query))).status).toBe(400);
    expect(backend).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 500, 503])('sanitizes upstream error %s', async status => {
    vi.mocked(backend).mockResolvedValue({
      status,
      data: { private: 'secret' }
    });
    const result = await GET(req());
    expect(result.status).toBe([401, 403].includes(status) ? status : 503);
    expect(JSON.stringify(await result.json())).not.toContain('secret');
  });
  it('rejects malformed success and mismatched period', async () => {
    for (const data of [{}, overview('day')]) {
      vi.mocked(backend).mockResolvedValue({ status: 200, data });
      expect((await GET(req())).status).toBe(503);
    }
  });
  it('forwards validated historical dates and pagination and rejects malformed filters', async () => {
    const data = overview();
    data.bookingList = { total: 9, page: 2, pageSize: 5 };
    vi.mocked(backend).mockResolvedValue({ status: 200, data });
    expect((await GET(req('period=month&date=2026-09-01&page=2'))).status).toBe(503);
    data.bookings.period = 'month';
    data.revenue.period = 'month';
    expect((await GET(req('period=month&date=2026-09-01&page=2'))).status).toBe(200);
    expect(backend).toHaveBeenCalledWith(
      '/mad/analytics/overview?period=month&date=2026-09-01&page=2',
      'GET',
      'private-token'
    );
    for (const query of [
      'period=week&date=2026-02-30',
      'period=week&page=0',
      'period=week&pageSize=51',
      'period=week&date=2026-09-01&date=2026-08-01'
    ])
      expect((await GET(req(query))).status).toBe(400);
  });
});
