// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/rooms/status/route';
import { backend } from '@/lib/backend';
import { roomsSnapshot } from './rooms-fixture';
vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
const req = (query = '', cookie = true) =>
  new NextRequest('http://localhost/api/rooms/status?' + query, {
    headers: cookie ? { cookie: 'mad_session=private' } : {},
  });
beforeEach(() => vi.mocked(backend).mockReset());
describe('DDP-028 room BFF', () => {
  it('returns a validated read-only snapshot without leaking upstream extras', async () => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: { ...roomsSnapshot(), secret: 'hidden' },
    });
    const response = await GET(req());
    expect(await response.json()).toEqual(roomsSnapshot());
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(backend).toHaveBeenCalledWith('/mad/rooms/status', 'GET', 'private');
  });
  it('rejects missing sessions and unsupported filters without upstream access', async () => {
    expect((await GET(req('', false))).status).toBe(401);
    expect((await GET(req('page=1'))).status).toBe(400);
    expect(backend).not.toHaveBeenCalled();
  });
  it.each([401, 403, 400, 500])(
    'sanitizes upstream failure %s',
    async (status) => {
      vi.mocked(backend).mockResolvedValue({
        status,
        data: { secret: 'hidden' },
      });
      const response = await GET(req());
      expect(response.status).toBe([401, 403].includes(status) ? status : 503);
      expect(JSON.stringify(await response.json())).not.toContain('hidden');
    },
  );
  it('rejects duplicate, malformed or mismatched room data', async () => {
    const good = roomsSnapshot();
    for (const data of [
      {},
      { ...good, rooms: [good.rooms[0], good.rooms[0]] },
      { ...good, rooms: [{ ...good.rooms[0], floor: null }] },
      { ...good, rooms: [{ ...good.rooms[0], number: 'other' }] },
    ]) {
      vi.mocked(backend).mockResolvedValue({ status: 200, data });
      expect((await GET(req())).status).toBe(503);
    }
  });
});
