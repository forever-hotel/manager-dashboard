import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { overviewSchema, analyticsQuerySchema } from '@/lib/analytics';

export async function GET(request: NextRequest) {
  const reply = (data: unknown, status: number) =>
    NextResponse.json(data, {
      status,
      headers: { 'Cache-Control': 'no-store' }
    });
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  const query = request.nextUrl.searchParams;
  const filters = analyticsQuerySchema.safeParse(Object.fromEntries(query));

  if (!filters.success || [...query.keys()].some(key => query.getAll(key).length !== 1))
    return reply({ code: 'VALIDATION_ERROR' }, 400);
  const result = await backend('/mad/analytics/overview?' + query, 'GET', token);

  if (result.status === 401 || result.status === 403)
    return reply({ code: result.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' }, result.status);
  const parsed = overviewSchema.safeParse(result.data);

  if (
    result.status !== 200 ||
    !parsed.success ||
    parsed.data.bookings.period !== filters.data.period ||
    parsed.data.bookingList.page !== (filters.data.page ?? 1) ||
    parsed.data.bookingList.pageSize !== (filters.data.pageSize ?? 5)
  )
    return reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
  return reply(parsed.data, 200);
}
