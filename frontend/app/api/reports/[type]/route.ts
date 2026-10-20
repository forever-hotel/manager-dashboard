import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import { serverConfig } from '@/lib/environment';
import {
  reportQuery,
  reportFilename,
  readReport,
  type ReportType,
} from '@/lib/reports';
const reply = (status: number) =>
  NextResponse.json(
    {
      code: (
        {
          400: 'VALIDATION_ERROR',
          401: 'UNAUTHENTICATED',
          403: 'FORBIDDEN',
          404: 'NOT_FOUND',
          422: 'REPORT_TOO_LARGE',
          503: 'SERVICE_UNAVAILABLE',
        } as Record<number, string>
      )[status],
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ type: string }> },
) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply(401);
  const { type } = await context.params;
  let query: URLSearchParams;
  try {
    query = reportQuery(type, request.nextUrl.searchParams);
  } catch {
    return reply(400);
  }
  let upstream: Response | undefined;
  try {
    const config = serverConfig();
    if (
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (request.headers.get('origin') &&
        request.headers.get('origin') !== config.origin)
    )
      return reply(403);
    upstream = await fetch(
      config.api + '/mad/reports/' + type + '?' + query.toString(),
      {
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
        headers: { Authorization: 'Bearer ' + token },
      },
    );
    if (upstream.status !== 200) {
      await upstream.body?.cancel();
      return reply(
        [400, 401, 403, 404, 422].includes(upstream.status)
          ? upstream.status
          : 503,
      );
    }
    const format = query.get('format')!;
    const filename = reportFilename(
      type as ReportType,
      format,
      upstream.headers.get('content-disposition'),
    );
    const bytes = await readReport(upstream, format);
    return new NextResponse(bytes, {
      headers: {
        'Content-Type':
          format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return reply(503);
  } finally {
    await upstream?.body?.cancel().catch(() => undefined);
  }
}
