import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { roomSnapshotSchema } from '@/lib/rooms';

export async function GET(request: NextRequest) {
  const reply = (data: unknown, status: number) =>
    NextResponse.json(data, {
      status,
      headers: { 'Cache-Control': 'no-store' }
    });
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  if (request.nextUrl.searchParams.size) return reply({ code: 'VALIDATION_ERROR' }, 400);
  const result = await backend('/mad/rooms/status', 'GET', token);
  if ([401, 403].includes(result.status))
    return reply({ code: result.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' }, result.status);
  const parsed = roomSnapshotSchema.safeParse(result.data);
  if (result.status !== 200 || !parsed.success) return reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
  return reply(parsed.data, 200);
}
