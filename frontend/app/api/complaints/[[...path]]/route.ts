import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { serverConfig } from '@/lib/environment';
import {
  complaintDetailSchema,
  complaintPageSchema,
  complaintPatchSchema,
  complaintQuerySchema,
  complaintSchema,
} from '@/lib/complaints';
type Context = { params: Promise<{ path?: string[] }> };
const reply = (data: unknown, status: number) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function handle(request: NextRequest, context: Context) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  const path = (await context.params).path ?? [];
  const detail = path.length === 1 && z.uuid().safeParse(path[0]).success;
  if (!(
    (request.method === 'GET' && (path.length === 0 || detail)) ||
    (request.method === 'PATCH' && detail)
  ))
    return reply({ code: 'NOT_FOUND' }, 404);
  const params = request.nextUrl.searchParams;
  let query = '',
    body: unknown;
  if (request.method === 'GET' && !detail) {
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
      return reply({ code: 'VALIDATION_ERROR' }, 400);
    const parsed = complaintQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) return reply({ code: 'VALIDATION_ERROR' }, 400);
    query = '?' + new URLSearchParams(parsed.data).toString();
  } else if (request.nextUrl.search)
    return reply({ code: 'VALIDATION_ERROR' }, 400);
  if (request.method === 'PATCH') {
    if (
      request.headers.get('origin') !== serverConfig().origin ||
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      !request.headers.get('content-type')?.startsWith('application/json')
    )
      return reply({ code: 'FORBIDDEN' }, 403);
    try {
      const text = await request.text();
      if (text.length > 32768) return reply({ code: 'PAYLOAD_TOO_LARGE' }, 413);
      const parsed = complaintPatchSchema.safeParse(JSON.parse(text));
      if (!parsed.success) return reply({ code: 'VALIDATION_ERROR' }, 400);
      body = parsed.data;
    } catch {
      return reply({ code: 'VALIDATION_ERROR' }, 400);
    }
  }
  const result = await backend(
    '/mad/complaints' + (detail ? '/' + path[0] : '') + query,
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
        code: {
          400: 'VALIDATION_ERROR',
          401: 'UNAUTHENTICATED',
          403: 'FORBIDDEN',
          404: 'NOT_FOUND',
          409: 'CONFLICT',
          503: 'SERVICE_UNAVAILABLE',
        }[status as 400 | 401 | 403 | 404 | 409 | 503],
      },
      status,
    );
  }
  const parsed = (
    request.method === 'PATCH'
      ? complaintSchema
      : detail
        ? complaintDetailSchema
        : complaintPageSchema
  ).safeParse(result.data);
  return parsed.success
    ? reply(parsed.data, 200)
    : reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
}
export const GET = handle;
export const PATCH = handle;
