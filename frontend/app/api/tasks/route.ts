import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { taskStatuses, tasksSnapshotSchema } from '@/lib/tasks';
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
    if (!['status', 'worker', 'workerName', 'page', 'pageSize'].includes(key) || query.getAll(key).length !== 1)
      return reply({ code: 'VALIDATION_ERROR' }, 400);
  const status = query.get('status'),
    worker = query.get('worker');
  const workerName = query.get('workerName');
  const page = query.get('page') ?? '1',
    size = query.get('pageSize') ?? '20';
  if (
    (status !== null && !taskStatuses.includes(status as (typeof taskStatuses)[number])) ||
    (worker !== null && !z.uuid().safeParse(worker).success) ||
    (workerName !== null && (workerName.length > 200 || /\p{Cc}/u.test(workerName))) ||
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
  if (worker) params.set('worker', worker);
  if (workerName?.trim()) params.set('workerName', workerName.trim());
  const result = await backend('/mad/tasks?' + params.toString(), 'GET', token);
  if ([401, 403].includes(result.status))
    return reply({ code: result.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' }, result.status);
  const parsed = tasksSnapshotSchema.safeParse(result.data);
  if (
    result.status !== 200 ||
    !parsed.success ||
    parsed.data.page !== Number(page) ||
    parsed.data.pageSize !== Number(size)
  )
    return reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
  return reply(parsed.data, 200);
}
