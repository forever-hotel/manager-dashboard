// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/analytics/occupancy/route';
import { backend } from '@/lib/backend';
import { occupancy } from './occupancy-fixture';
vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
const req = (query = 'month=2024-02', cookie = true) =>
  new NextRequest(`http://localhost/api/analytics/occupancy?${query}`, {
    headers: cookie ? { cookie: 'mad_session=private-token' } : {}
  });
describe('DDP-016 protected occupancy BFF contract', () => {
  beforeEach(() => vi.mocked(backend).mockReset());
  it('requests exact hotel-local month bounds and strips unrecognized fields', async () => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...occupancy(), secret: 'private' }
    });
    const result = await GET(req());
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(occupancy());
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(backend).toHaveBeenCalledWith(
      '/mad/analytics/occupancy?from=2024-02-01&to=2024-02-29',
      'GET',
      'private-token'
    );
  });
  it('rejects missing sessions and malformed or duplicate input before upstream access', async () => {
    expect((await GET(req('month=2024-02', false))).status).toBe(401);
    for (const query of [
      '',
      'month=2024-13',
      'month=0000-01',
      'month=2024-2',
      'month=2024-02&month=2024-03',
      'month=2024-02&extra=1'
    ])
      expect((await GET(req(query))).status).toBe(400);
    expect(backend).not.toHaveBeenCalled();
  });
  it.each([401, 403, 500, 503])('sanitizes upstream failure %s', async status => {
    vi.mocked(backend).mockResolvedValue({
      status,
      data: { secret: 'private' }
    });
    const result = await GET(req());
    expect(result.status).toBe(status === 401 || status === 403 ? status : 503);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await result.json())).not.toContain('private');
  });
  it('rejects invalid success payloads and mismatched months', async () => {
    for (const data of [{}, occupancy('2024-03')]) {
      vi.mocked(backend).mockResolvedValue({ status: 200, data });
      expect((await GET(req())).status).toBe(503);
    }
  });
});
