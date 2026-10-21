import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { serverConfig } from '@/lib/environment';
import {
  notificationsSchema,
  readNotificationSchema,
} from '@/lib/notifications';
type Context = { params: Promise<{ path?: string[] }> };
const reply = (data: unknown, status: number) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function handle(request: NextRequest, context: Context) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  const path = (await context.params).path ?? [];
  const list = request.method === 'GET' && path.length === 0;
  const read =
    request.method === 'PATCH' &&
    path.length === 3 &&
    ['COMPLAINT', 'STOCK'].includes(path[0]) &&
    z.uuid().safeParse(path[1]).success &&
    path[2] === 'read';
  if (!list && !read) return reply({ code: 'NOT_FOUND' }, 404);
  const params = request.nextUrl.searchParams;
  let query = '',
    body: unknown;
  const page = params.get('page') ?? '1',
    size = params.get('pageSize') ?? '20';
  if (list) {
    if (
      [...params.keys()].some(
        (k) =>
          !['page', 'pageSize'].includes(k) || params.getAll(k).length !== 1,
      ) ||
      !/^\d+$/.test(page) ||
      Number(page) < 1 ||
      Number(page) > 100000 ||
      !/^\d+$/.test(size) ||
      Number(size) < 1 ||
      Number(size) > 100
    )
      return reply({ code: 'VALIDATION_ERROR' }, 400);
    query = '?' + new URLSearchParams({ page, pageSize: size });
  } else {
    if (request.nextUrl.search) return reply({ code: 'VALIDATION_ERROR' }, 400);
    if (
      request.headers.get('origin') !== serverConfig().origin ||
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      !request.headers.get('content-type')?.startsWith('application/json')
    )
      return reply({ code: 'FORBIDDEN' }, 403);
    try {
      const text = await request.text();
      if (text.length > 2048) return reply({ code: 'PAYLOAD_TOO_LARGE' }, 413);
      const parsed = readNotificationSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return reply({ code: 'VALIDATION_ERROR' }, 400);
      body = parsed.data;
    } catch {
      return reply({ code: 'VALIDATION_ERROR' }, 400);
    }
  }
  const result = await backend(
    '/mad/notifications' + (read ? '/' + path.join('/') : '') + query,
    request.method,
    token,
    body,
  );
  if (result.status !== 200) {
    const status = [400, 401, 403, 404, 409].includes(result.status)
      ? result.status
      : 503;
    return reply(
      {
        code:
          (
            {
              400: 'VALIDATION_ERROR',
              401: 'UNAUTHENTICATED',
              403: 'FORBIDDEN',
              404: 'NOT_FOUND',
              409: 'CONFLICT',
            } as Record<number, string>
          )[status] ?? 'SERVICE_UNAVAILABLE',
      },
      status,
    );
  }
  if (read)
    return z.object({ read: z.literal(true) }).safeParse(result.data).success
      ? reply({ read: true }, 200)
      : reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
  const parsed = notificationsSchema.safeParse(result.data);
  return parsed.success &&
    parsed.data.page === Number(page) &&
    parsed.data.pageSize === Number(size)
    ? reply(parsed.data, 200)
    : reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
}
export const GET = handle;
export const PATCH = handle;
