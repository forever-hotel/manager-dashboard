import { NextRequest, NextResponse } from 'next/server';
import { backend } from '@/lib/backend';
import { isSession, publicSession, SESSION_COOKIE } from '@/lib/auth';
import { serverConfig } from '@/lib/environment';

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  if ((await context.params).action !== 'session')
    return reply({ code: 'NOT_FOUND' }, 404);
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  const result = await backend('/auth/session', 'GET', token);
  if (result.status === 200 && isSession(result.data))
    return reply(publicSession(result.data));
  const status = result.status >= 500 ? 503 : result.status === 403 ? 403 : 401;
  const response = reply(
    {
      code:
        status === 503
          ? 'SERVICE_UNAVAILABLE'
          : status === 403
            ? 'FORBIDDEN'
            : 'UNAUTHENTICATED',
    },
    status,
  );
  if (status === 401 || status === 403) response.cookies.delete(SESSION_COOKIE);
  return response;
}
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  const { origin } = serverConfig();
  if (
    request.headers.get('origin') !== origin ||
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    !request.headers.get('content-type')?.startsWith('application/json')
  )
    return reply(
      { code: 'FORBIDDEN', message: 'Invalid request origin.' },
      403,
    );
  const { action } = await context.params;
  if (!['login', 'logout', 'change-password'].includes(action))
    return reply({ code: 'NOT_FOUND' }, 404);
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (action !== 'login' && !token)
    return reply({ code: 'UNAUTHENTICATED' }, 401);
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 4096) return reply({ code: 'PAYLOAD_TOO_LARGE' }, 413);
    body = JSON.parse(text);
  } catch {
    return reply(
      { code: 'VALIDATION_ERROR', message: 'Invalid request.' },
      400,
    );
  }
  const result = await backend('/auth/' + action, 'POST', token, body);
  if (action === 'logout') {
    // Retain the cookie on failure so the user can retry durable revocation.
    const signedOut = result.status === 200 || result.status === 401;
    const response = reply(
      { code: signedOut ? 'SIGNED_OUT' : 'SERVICE_UNAVAILABLE' },
      signedOut ? 200 : 503,
    );
    if (signedOut) response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  if (
    result.status !== 200 ||
    !isSession(result.data) ||
    !('accessToken' in result.data) ||
    typeof result.data.accessToken !== 'string'
  ) {
    const status = [400, 401, 403].includes(result.status)
      ? result.status
      : 503;
    return reply(
      {
        code: status === 503 ? 'SERVICE_UNAVAILABLE' : 'AUTHENTICATION_FAILED',
        message:
          status === 503
            ? 'Sign-in service unavailable. Please retry.'
            : 'Unable to sign in. Check your details and try again.',
      },
      status,
    );
  }
  const { accessToken } = result.data;
  const session = publicSession(result.data);
  const response = reply(session);
  response.cookies.set(SESSION_COOKIE, accessToken, {
    httpOnly: true,
    secure: new URL(origin).protocol === 'https:',
    sameSite: 'strict',
    path: '/',
    maxAge: Math.max(0, session.expiresAt - Math.floor(Date.now() / 1000)),
  });
  return response;
}
