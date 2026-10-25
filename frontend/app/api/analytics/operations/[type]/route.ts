import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { foodSchema, serviceSchema, workerSchema } from '@/lib/operations-analytics';
const reply = (data: unknown, status: number) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: NextRequest, context: { params: Promise<{ type: string }> }) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  const { type } = await context.params;
  if (!['food-orders', 'service-requests', 'worker-performance'].includes(type))
    return reply({ code: 'NOT_FOUND' }, 404);
  const query = request.nextUrl.searchParams;
  if ([...query.keys()].some(k => query.getAll(k).length !== 1)) return reply({ code: 'VALIDATION_ERROR' }, 400);
  const parsed = z
    .object({
      period: z.enum(['day', 'week', 'month']).default('day'),
      ...(type === 'worker-performance' ? { workerId: z.uuid().optional() } : {})
    })
    .strict()
    .safeParse(Object.fromEntries(query));
  if (!parsed.success) return reply({ code: 'VALIDATION_ERROR' }, 400);
  const result = await backend(
    '/mad/analytics/' + type + '?' + new URLSearchParams(parsed.data as Record<string, string>).toString(),
    'GET',
    token
  );
  if ([401, 403].includes(result.status))
    return reply({ code: result.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' }, result.status);
  const data = (
    type === 'food-orders' ? foodSchema : type === 'service-requests' ? serviceSchema : workerSchema
  ).safeParse(result.data);
  if (result.status !== 200 || !data.success || data.data.period !== parsed.data.period)
    return reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
  return reply(data.data, 200);
}
