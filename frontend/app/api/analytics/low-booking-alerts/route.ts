import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { lowDemandSchema } from '@/lib/low-demand';

export async function GET(request: NextRequest) {
  const reply = (data: unknown, status: number) =>
    NextResponse.json(data, {
      status,
      headers: { 'Cache-Control': 'no-store' }
    });
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  if (request.nextUrl.search) return reply({ code: 'VALIDATION_ERROR' }, 400);
  const result = await backend('/mad/analytics/low-booking-alerts', 'GET', token);
  if (result.status === 401 || result.status === 403)
    return reply({ code: result.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' }, result.status);
  const parsed = lowDemandSchema.safeParse(result.data);
  if (result.status !== 200 || !parsed.success) return reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
  return reply(parsed.data, 200);
}
