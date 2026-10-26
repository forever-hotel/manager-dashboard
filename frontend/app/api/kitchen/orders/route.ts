import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { kitchenSnapshotSchema, kitchenStatuses } from '@/lib/kitchen';
export async function GET(request: NextRequest) {
  const reply = (data: unknown, status: number) =>
    NextResponse.json(data, {
      status,
      headers: { 'Cache-Control': 'no-store' }
    });
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  const query = request.nextUrl.searchParams;
  for (const key of query.keys())
    if (!['status', 'page', 'pageSize', 'activeOnly'].includes(key) || query.getAll(key).length !== 1)
      return reply({ code: 'VALIDATION_ERROR' }, 400);
  const status = query.get('status');
  const activeOnly = query.get('activeOnly');
  const page = query.get('page') ?? '1';
  const size = query.get('pageSize') ?? '100';
  if (
    (status !== null && !kitchenStatuses.includes(status as (typeof kitchenStatuses)[number])) ||
    (activeOnly !== null && !['true', 'false'].includes(activeOnly)) ||
    !/^\d+$/.test(page) ||
    Number(page) < 1 ||
    Number(page) > 100000 ||
    !/^\d+$/.test(size) ||
    Number(size) < 1 ||
    Number(size) > 100
  )
    return reply({ code: 'VALIDATION_ERROR' }, 400);
  const params = new URLSearchParams({ page, pageSize: size });
  if (status) params.set('status', status);
  if (activeOnly !== null) params.set('activeOnly', activeOnly);
  const result = await backend('/mad/kitchen/orders?' + params.toString(), 'GET', token);
  if ([401, 403].includes(result.status))
    return reply({ code: result.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' }, result.status);
  const parsed = kitchenSnapshotSchema.safeParse(result.data);
  if (
    result.status !== 200 ||
    !parsed.success ||
    parsed.data.page !== Number(page) ||
    parsed.data.pageSize !== Number(size) ||
    (activeOnly === 'true' &&
      (parsed.data.counts.DELIVERED !== 0 || parsed.data.orders.some(order => order.status === 'DELIVERED')))
  )
    return reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
  return reply(parsed.data, 200);
}
