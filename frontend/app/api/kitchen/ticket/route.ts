import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { httpUrl, serverConfig } from '@/lib/environment';
export async function POST(request: NextRequest) {
  const reply = (data: unknown, status: number) =>
    NextResponse.json(data, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    });
  if (request.headers.get('origin') !== serverConfig().origin)
    return reply({ code: 'FORBIDDEN' }, 403);
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  const result = await backend('/mad/realtime/ticket', 'POST', token);
  if ([401, 403].includes(result.status))
    return reply(
      { code: result.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' },
      result.status,
    );
  const data = result.data as { ticket?: unknown };
  if (
    result.status !== 201 ||
    typeof data?.ticket !== 'string' ||
    !/^[\w-]{43}$/.test(data.ticket)
  )
    return reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
  try {
    const socketUrl = httpUrl(
      'MAD_SOCKET_PUBLIC_URL',
      process.env.MAD_SOCKET_PUBLIC_URL,
    );
    if (
      new URL(socketUrl).pathname !== '/' ||
      (new URL(serverConfig().origin).protocol === 'https:' &&
        new URL(socketUrl).protocol !== 'https:')
    )
      throw new Error();
    return reply({ ticket: data.ticket, socketUrl }, 200);
  } catch {
    return reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
  }
}
