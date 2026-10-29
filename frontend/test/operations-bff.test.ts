// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/analytics/operations/[type]/route';
import { backend } from '@/lib/backend';
import { foodFixture, serviceFixture, workerFixture } from './operations-fixture';
vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
const req = (query = 'period=week', cookie = true) =>
  new NextRequest('http://localhost/api/analytics/operations?' + query, {
    headers: cookie ? { cookie: 'mad_session=private' } : {}
  });
const ctx = (type: string) => ({ params: Promise.resolve({ type }) });
beforeEach(() => vi.mocked(backend).mockReset());
describe('DDP-032/033 analytics proxy', () => {
  it.each([
    ['food-orders', foodFixture],
    ['service-requests', serviceFixture],
    ['worker-performance', workerFixture]
  ] as const)('returns allowlisted %s data', async (type, fixture) => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...fixture(), password: 'secret' }
    });
    const response = await GET(req(), ctx(type));
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
    expect(backend).toHaveBeenCalledWith('/mad/analytics/' + type + '?period=week', 'GET', 'private');
  });
  it('forwards historical worker dates', async () => {
    vi.mocked(backend).mockResolvedValue({ status: 200, data: workerFixture() });
    expect((await GET(req('period=week&date=2026-09-01'), ctx('worker-performance'))).status).toBe(200);
    expect(backend).toHaveBeenCalledWith(
      '/mad/analytics/worker-performance?period=week&date=2026-09-01',
      'GET',
      'private'
    );
  });
  it('rejects invalid input and absent authentication', async () => {
    expect((await GET(req('', false), ctx('food-orders'))).status).toBe(401);
    for (const query of ['period=year', 'period=day&period=week', 'extra=1', 'workerId=bad'])
      expect((await GET(req(query), ctx('worker-performance'))).status).toBe(400);
    expect((await GET(req(), ctx('unknown'))).status).toBe(404);
    expect(backend).not.toHaveBeenCalled();
  });
  it.each([401, 403, 500])('sanitizes status %s', async status => {
    vi.mocked(backend).mockResolvedValue({
      status,
      data: { private: 'secret' }
    });
    expect((await GET(req(), ctx('food-orders'))).status).toBe(status === 500 ? 503 : status);
  });
  it('rejects schema errors and period mismatches', async () => {
    for (const data of [{}, { ...foodFixture(), period: 'day' }]) {
      vi.mocked(backend).mockResolvedValue({ status: 200, data });
      expect((await GET(req(), ctx('food-orders'))).status).toBe(503);
    }
  });
});
