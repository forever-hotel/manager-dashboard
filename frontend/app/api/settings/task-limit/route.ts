import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { serverConfig } from '@/lib/environment';
import { taskLimitInput, taskLimitSchema } from '@/lib/task-limit';
const reply = (data: unknown, status: number) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function handle(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  if (request.nextUrl.search) return reply({ code: 'VALIDATION_ERROR' }, 400);
  let body: unknown;
  if (request.method === 'PATCH') {
    if (
      request.headers.get('origin') !== serverConfig().origin ||
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      !request.headers.get('content-type')?.startsWith('application/json')
    )
      return reply({ code: 'FORBIDDEN' }, 403);
    try {
      const text = await request.text();
      if (text.length > 2048) return reply({ code: 'PAYLOAD_TOO_LARGE' }, 413);
      const parsed = taskLimitInput.safeParse(JSON.parse(text));
      if (!parsed.success) return reply({ code: 'VALIDATION_ERROR' }, 400);
      body = parsed.data;
    } catch {
      return reply({ code: 'VALIDATION_ERROR' }, 400);
    }
  }
  const result = await backend(
    '/mad/settings/task-limit',
    request.method,
    token,
    body,
  );
  if (result.status !== 200) {
    const status = [400, 401, 403, 409].includes(result.status)
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
              409: 'CONFLICT',
            } as Record<number, string>
          )[status] ?? 'SERVICE_UNAVAILABLE',
      },
      status,
    );
  }
  const parsed = taskLimitSchema.safeParse(result.data);
  return parsed.success
    ? reply(parsed.data, 200)
    : reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
}
export const GET = handle;
export const PATCH = handle;
