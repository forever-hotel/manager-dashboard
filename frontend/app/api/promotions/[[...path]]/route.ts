import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { serverConfig } from '@/lib/environment';
import { createSchema, editSchema, pageSchema, promotionSchema, roomSchema, versionSchema } from '@/lib/promotions';

type Context = { params: Promise<{ path?: string[] }> };
const reply = (data: unknown, status: number) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function handle(request: NextRequest, context: Context) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  const path = (await context.params).path ?? [];
  const method = request.method;
  const list = path.length === 0 || (path.length === 1 && path[0] === 'room-types');
  const detail = path.length === 1 && z.uuid().safeParse(path[0]).success;
  const action =
    path.length === 2 && z.uuid().safeParse(path[0]).success && ['activate', 'deactivate'].includes(path[1]);
  if (!(
    (method === 'GET' && (list || detail)) ||
    (method === 'POST' && (path.length === 0 || action)) ||
    (['PUT', 'DELETE'].includes(method) && detail)
  ))
    return reply({ code: 'NOT_FOUND' }, 404);
  let query = '',
    body: unknown;
  if (method === 'GET') {
    const params = request.nextUrl.searchParams;
    if ([...params.keys()].some(key => !list || !['page', 'pageSize'].includes(key) || params.getAll(key).length !== 1))
      return reply({ code: 'VALIDATION_ERROR' }, 400);
    if (list) {
      for (const [key, max, fallback] of [
        ['page', 1000000, 1],
        ['pageSize', 100, 20]
      ] as const) {
        const raw = params.get(key) ?? String(fallback);
        if (!/^[1-9]\d*$/.test(raw) || Number(raw) > max) return reply({ code: 'VALIDATION_ERROR' }, 400);
      }
      query = '?' + params.toString();
    }
  } else {
    if (
      request.headers.get('origin') !== serverConfig().origin ||
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      !request.headers.get('content-type')?.startsWith('application/json')
    )
      return reply({ code: 'FORBIDDEN' }, 403);
    if (request.nextUrl.search) return reply({ code: 'VALIDATION_ERROR' }, 400);
    try {
      const text = await request.text();
      if (text.length > 16384) return reply({ code: 'PAYLOAD_TOO_LARGE' }, 413);
      const schema = method === 'PUT' ? editSchema : path.length === 0 ? createSchema : versionSchema;
      const parsed = schema.safeParse(JSON.parse(text));
      if (!parsed.success) return reply({ code: 'VALIDATION_ERROR' }, 400);
      body = parsed.data;
    } catch {
      return reply({ code: 'VALIDATION_ERROR' }, 400);
    }
  }
  const result = await backend(
    '/mad/promotions' + (path.length ? '/' + path.join('/') : '') + query,
    method,
    token,
    body
  );
  if (![200, 201].includes(result.status)) {
    const status = [400, 401, 403, 404, 409].includes(result.status) ? result.status : 503;
    return reply(
      {
        code: {
          400: 'VALIDATION_ERROR',
          401: 'UNAUTHENTICATED',
          403: 'FORBIDDEN',
          404: 'NOT_FOUND',
          409: 'CONFLICT',
          503: 'SERVICE_UNAVAILABLE'
        }[status as 400 | 401 | 403 | 404 | 409 | 503]
      },
      status
    );
  }
  const schema =
    method === 'GET' && list
      ? path[0] === 'room-types'
        ? pageSchema(roomSchema)
        : pageSchema(promotionSchema)
      : promotionSchema;
  const parsed = schema.safeParse(result.data);
  return parsed.success ? reply(parsed.data, result.status) : reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
