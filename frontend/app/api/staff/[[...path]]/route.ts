import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { serverConfig } from '@/lib/environment';
import {
  staffQuery,
  staffInput,
  staffPatch,
  staffReset,
  staffDetail,
  staffProfile,
  staffPage,
  staffReceipt,
} from '@/lib/staff';
type Context = { params: Promise<{ path?: string[] }> };
const reply = (data: unknown, status: number) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function handle(request: NextRequest, context: Context) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  const path = (await context.params).path ?? [];
  const id = z.uuid().safeParse(path[0]).success;
  const detail = path.length === 1 && id;
  const reset = path.length === 2 && id && path[1] === 'reset-password';
  const method = request.method;
  if (!(
    (method === 'GET' && (path.length === 0 || detail)) ||
    (method === 'POST' && (path.length === 0 || reset)) ||
    (method === 'PATCH' && detail)
  ))
    return reply({ code: 'NOT_FOUND' }, 404);
  let query = '',
    body: unknown;
  if (method === 'GET' && path.length === 0) {
    const params = request.nextUrl.searchParams;
    if ([...params.keys()].some((k) => params.getAll(k).length !== 1))
      return reply({ code: 'VALIDATION_ERROR' }, 400);
    const parsed = staffQuery.safeParse(Object.fromEntries(params));
    if (!parsed.success) return reply({ code: 'VALIDATION_ERROR' }, 400);
    query = '?' + new URLSearchParams(parsed.data).toString();
  } else if (request.nextUrl.search)
    return reply({ code: 'VALIDATION_ERROR' }, 400);
  if (method !== 'GET') {
    if (
      request.headers.get('origin') !== serverConfig().origin ||
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      !request.headers.get('content-type')?.startsWith('application/json')
    )
      return reply({ code: 'FORBIDDEN' }, 403);
    try {
      const raw = await request.text();
      if (raw.length > 16384) return reply({ code: 'PAYLOAD_TOO_LARGE' }, 413);
      const parsed = (
        reset ? staffReset : method === 'PATCH' ? staffPatch : staffInput
      ).safeParse(JSON.parse(raw));
      if (!parsed.success) return reply({ code: 'VALIDATION_ERROR' }, 400);
      body = parsed.data;
    } catch {
      return reply({ code: 'VALIDATION_ERROR' }, 400);
    }
  }
  const result = await backend(
    '/mad/staff' + (path.length ? '/' + path.join('/') : '') + query,
    method,
    token,
    body,
  );
  const expected = method === 'POST' && !reset ? 201 : 200;
  if (result.status !== expected) {
    const status = [400, 401, 403, 404, 409].includes(result.status)
      ? result.status
      : 503;
    return reply(
      {
        code: (
          {
            400: 'VALIDATION_ERROR',
            401: 'UNAUTHENTICATED',
            403: 'FORBIDDEN',
            404: 'NOT_FOUND',
            409: 'CONFLICT',
            503: 'SERVICE_UNAVAILABLE',
          } as Record<number, string>
        )[status],
      },
      status,
    );
  }
  const schema =
    method === 'POST'
      ? staffReceipt
      : method === 'PATCH'
        ? staffProfile
        : detail
          ? staffDetail
          : staffPage;
  const parsed = schema.safeParse(result.data);
  return parsed.success
    ? reply(parsed.data, expected)
    : reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
