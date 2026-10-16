// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, PATCH } from '@/app/api/complaints/[[...path]]/route';
import { backend } from '@/lib/backend';
import { complaint, complaintPage } from './complaints-fixture';
vi.mock('@/lib/backend', () => ({ backend: vi.fn() }));
vi.mock('@/lib/environment', () => ({
  serverConfig: () => ({ origin: 'http://localhost' }),
}));
const context = (path: string[] = []) => ({
  params: Promise.resolve({ path }),
});
const input = { version: 0, status: 'UNDER_REVIEW', note: 'Private note' };
function req(
  method = 'GET',
  body?: unknown,
  query = '',
  headers: Record<string, string> = {},
) {
  return new NextRequest('http://localhost/api/complaints' + query, {
    method,
    headers: {
      cookie: 'mad_session=private-token',
      origin: 'http://localhost',
      'content-type': 'application/json',
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
describe('DDP-022 complaint BFF contracts', () => {
  beforeEach(() => vi.mocked(backend).mockReset());
  it('validates and forwards filters while stripping notes and arbitrary provider fields from lists', async () => {
    vi.mocked(backend).mockResolvedValue({
      status: 200,
      data: complaintPage([
        {
          ...complaint(),
          history: [
            {
              version: 1,
              fromStatus: 'SUBMITTED',
              status: 'UNDER_REVIEW',
              actorId: complaint().id,
              note: 'private',
              recordedAt: complaint().submittedAt,
            },
          ],
        },
      ]),
    });
    const result = await GET(
      req('GET', undefined, '?status=SUBMITTED&page=2&category=Room'),
      context(),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await result.json())).not.toContain('private');
    expect(backend).toHaveBeenCalledWith(
      expect.stringContaining('/mad/complaints?'),
      'GET',
      'private-token',
      undefined,
    );
  });
  it('returns manager history on detail and a safe updated object on PATCH', async () => {
    vi.mocked(backend).mockResolvedValue({ status: 200, data: complaint() });
    expect(await (await GET(req(), context([complaint().id]))).json()).toEqual(
      complaint(),
    );
    const result = await PATCH(
      req('PATCH', { ...input, note: '  Private note  ' }),
      context([complaint().id]),
    );
    expect(result.status).toBe(200);
    expect(await result.json()).not.toHaveProperty('history');
    expect(backend).toHaveBeenLastCalledWith(
      '/mad/complaints/' + complaint().id,
      'PATCH',
      'private-token',
      input,
    );
  });
  it.each([400, 401, 403, 404, 409, 500, 503])(
    'sanitizes upstream %s without leaking notes',
    async (status) => {
      vi.mocked(backend).mockResolvedValue({
        status,
        data: { message: 'private note SQL' },
      });
      const result = await PATCH(
        req('PATCH', input),
        context([complaint().id]),
      );
      expect(result.status).toBe(status >= 500 ? 503 : status);
      expect(JSON.stringify(await result.json())).not.toContain('private');
    },
  );
  it('blocks unauthorized sessions, cross-origin requests and unsupported paths', async () => {
    expect(
      (await GET(req('GET', undefined, '', { cookie: '' }), context())).status,
    ).toBe(401);
    for (const headers of [
      { origin: 'https://attacker.invalid' },
      { 'sec-fetch-site': 'cross-site' },
      { 'content-type': 'text/plain' },
    ] as Record<string, string>[])
      expect(
        (
          await PATCH(
            req('PATCH', input, '', headers),
            context([complaint().id]),
          )
        ).status,
      ).toBe(403);
    expect((await GET(req(), context(['bad']))).status).toBe(404);
    expect((await PATCH(req('PATCH', input), context())).status).toBe(404);
    expect(backend).not.toHaveBeenCalled();
  });
  it('rejects invalid/duplicate filters, invalid writes and malformed successes', async () => {
    for (const query of [
      '?page=0',
      '?pageSize=101',
      '?page=1&page=2',
      '?status=BAD',
      '?workerId=bad',
      '?unknown=1',
      '?category=',
    ])
      expect((await GET(req('GET', undefined, query), context())).status).toBe(
        400,
      );
    expect(
      (await GET(req('GET', undefined, '?page=1'), context([complaint().id])))
        .status,
    ).toBe(400);
    for (const body of [
      { ...input, version: -1 },
      { ...input, note: '' },
      { ...input, actorId: complaint().id },
      { ...input, status: 'SUBMITTED' },
    ])
      expect(
        (await PATCH(req('PATCH', body), context([complaint().id]))).status,
      ).toBe(400);
    expect(
      (
        await PATCH(
          req('PATCH', { huge: 'x'.repeat(33000) }),
          context([complaint().id]),
        )
      ).status,
    ).toBe(413);
    const invalid = req('PATCH', input);
    vi.spyOn(invalid, 'text').mockResolvedValue('{');
    expect((await PATCH(invalid, context([complaint().id]))).status).toBe(400);
    expect(backend).not.toHaveBeenCalled();
    vi.mocked(backend).mockResolvedValue({ status: 200, data: {} });
    expect((await GET(req(), context())).status).toBe(503);
  });
});
