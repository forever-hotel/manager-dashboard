import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { monthDates, monthSchema, parseOccupancy } from '@/lib/occupancy';

export async function GET(request: NextRequest) {
  const reply = (data: unknown, status: number) =>
    NextResponse.json(data, {
      status,
      headers: { 'Cache-Control': 'no-store' }
    });
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  const query = request.nextUrl.searchParams;
  const month = monthSchema.safeParse(query.get('month'));

  if (!month.success || query.getAll('month').length !== 1 || [...query.keys()].some(key => key !== 'month')) {
    return reply({ code: 'VALIDATION_ERROR' }, 400);
  }
  const dates = monthDates(month.data);
  const result = await backend(`/mad/analytics/occupancy?from=${dates[0]}&to=${dates.at(-1)}`, 'GET', token);

  if (result.status === 401 || result.status === 403)
    return reply({ code: result.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' }, result.status);
  try {
    if (result.status !== 200) throw new Error('Occupancy unavailable');
    return reply(parseOccupancy(result.data, month.data), 200);
  } catch {
    return reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
  }
}
