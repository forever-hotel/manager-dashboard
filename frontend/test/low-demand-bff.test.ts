// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/analytics/low-booking-alerts/route';
import { backend } from '@/lib/backend';
import { lowDemand } from './low-demand-fixture';
vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
const req = (query = '', cookie = true) =>
  new NextRequest('http://localhost/api/analytics/low-booking-alerts' + query, {
    headers: cookie ? { cookie: 'mad_session=private-token' } : {},
  });
describe('DDP-057 low-demand BFF', () => {
  beforeEach(() => vi.mocked(backend).mockReset());
  it('returns validated noncached data and forwards credentials only server-side', async () => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...lowDemand(), private: 'secret' },
    });
    const result = await GET(req());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(lowDemand());
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(backend).toHaveBeenCalledWith(
      '/mad/analytics/low-booking-alerts',
      'GET',
      'private-token',
    );
  });
  it('rejects absent cookies and query parameters without upstream calls', async () => {
    expect((await GET(req('', false))).status).toBe(401);
    expect((await GET(req('?date=2028-02-29'))).status).toBe(400);
    expect(backend).not.toHaveBeenCalled();
  });
  it.each([401, 403, 500, 503])(
    'sanitizes upstream failure %s',
    async (status) => {
      vi.mocked(backend).mockResolvedValue({
        status,
        data: { private: 'secret' },
      });
      const result = await GET(req());
      expect(result.status).toBe([401, 403].includes(status) ? status : 503);
      expect(JSON.stringify(await result.json())).not.toContain('secret');
    },
  );
  it('rejects malformed successful data', async () => {
    vi.mocked(backend).mockResolvedValue({ status: 200, data: {} });
    expect((await GET(req())).status).toBe(503);
  });
});
