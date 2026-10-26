import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { SESSION_COOKIE } from '@/lib/auth';
import { backend } from '@/lib/backend';
import { serviceRequestListSchema } from '@/lib/service-requests';
const reply = (data: unknown, status: number) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  const query = request.nextUrl.searchParams;
  if ([...query.keys()].some(key => query.getAll(key).length !== 1)) return reply({ code: 'VALIDATION_ERROR' }, 400);
  const parsed = z
    .object({
      period: z.enum(['day', 'week', 'month']).default('day'),
      date: z.iso
        .date()
        .refine(value => !value.startsWith('0000'))
        .optional(),
      view: z.enum(['active', 'all']).default('all'),
      page: z.coerce.number().int().min(1).max(1000000).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20)
    })
    .strict()
    .safeParse(Object.fromEntries(query));
  if (!parsed.success) return reply({ code: 'VALIDATION_ERROR' }, 400);
  const params = new URLSearchParams(Object.entries(parsed.data).map(([key, value]) => [key, String(value)]));
  const result = await backend('/mad/analytics/service-requests/list?' + params, 'GET', token);
  if ([401, 403].includes(result.status))
    return reply({ code: result.status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN' }, result.status);
  const data = serviceRequestListSchema.safeParse(result.data);
  if (
    result.status !== 200 ||
    !data.success ||
    data.data.page !== parsed.data.page ||
    data.data.pageSize !== parsed.data.pageSize ||
    data.data.view !== parsed.data.view
  )
    return reply({ code: 'SERVICE_UNAVAILABLE' }, 503);
  return reply(data.data, 200);
}
