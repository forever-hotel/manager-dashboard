// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/service-requests/route';
import { backend } from '@/lib/backend';

vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
const req = (query = '', cookie = true) =>
  new NextRequest('http://localhost/api/service-requests?' + query, {
    headers: cookie ? { cookie: 'mad_session=private' } : {}
  });
const row = {
  id: '67f4568c-89ab-4c12-b321-123456789012',
  roomNumber: '204',
  category: 'ROOM_CLEANING',
  status: 'ASSIGNED',
  submittedAt: '2026-10-20T00:00:00Z',
  assignee: 'Worker One'
};
const data = { requests: [row], total: 1, page: 1, pageSize: 20, view: 'all' };
beforeEach(() => vi.mocked(backend).mockReset());
describe('service request list proxy', () => {
  it('authenticates and returns only approved fields', async () => {
    vi.mocked(backend).mockResolvedValue({ status: 200, data: { ...data, private: 'secret' } });
    const response = await GET(req());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(data);
    expect(backend).toHaveBeenCalledWith(
      '/mad/analytics/service-requests/list?period=day&view=all&page=1&pageSize=20',
      'GET',
      'private'
    );
  });
  it('forwards selected history dates and pagination', async () => {
    vi.mocked(backend).mockResolvedValue({ status: 200, data: { ...data, view: 'all', page: 2, requests: [] } });
    expect((await GET(req('view=all&period=month&date=2026-09-01&page=2'))).status).toBe(200);
    expect(backend).toHaveBeenCalledWith(
      '/mad/analytics/service-requests/list?period=month&date=2026-09-01&view=all&page=2&pageSize=20',
      'GET',
      'private'
    );
  });
  it('rejects invalid filters and missing sessions', async () => {
    expect((await GET(req('', false))).status).toBe(401);
    for (const query of ['page=0', 'pageSize=51', 'view=other', 'date=2026-02-30', 'view=active&view=all', 'extra=1'])
      expect((await GET(req(query))).status).toBe(400);
    expect(backend).not.toHaveBeenCalled();
  });
  it('rejects inconsistent pages, completed active rows and upstream failures', async () => {
    for (const result of [
      { ...data, page: 2 },
      { ...data, total: 2 },
      { ...data, view: 'active' }
    ]) {
      vi.mocked(backend).mockResolvedValue({ status: 200, data: result });
      expect((await GET(req())).status).toBe(503);
    }
    for (const status of [401, 403, 500]) {
      vi.mocked(backend).mockResolvedValue({ status, data: { private: 'secret' } });
      expect((await GET(req())).status).toBe(status === 500 ? 503 : status);
    }
  });
});
