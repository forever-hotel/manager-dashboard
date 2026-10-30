import { NextRequest, NextResponse } from 'next/server';
import { backend } from '@/lib/backend';
import { isSession, publicSession, SESSION_COOKIE } from '@/lib/auth';
import { serverConfig } from '@/lib/environment';

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { origin } = serverConfig();

  if (
    request.headers.get('origin') !== origin ||
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    !request.headers.get('content-type')?.startsWith('application/json')
  )
    return reply({ code: 'FORBIDDEN', message: 'Invalid request origin.' }, 403);
  const { action } = await context.params;

  if (!['login', 'logout', 'change-password', 'request-password-reset', 'reset-password'].includes(action))
    return reply({ code: 'NOT_FOUND' }, 404);
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (['logout', 'change-password'].includes(action) && !token) return reply({ code: 'UNAUTHENTICATED' }, 401);
  let body: unknown;

  try {
    const text = await request.text();

    if (text.length > 4096) return reply({ code: 'PAYLOAD_TOO_LARGE' }, 413);
    body = JSON.parse(text);
  } catch {
    return reply({ code: 'VALIDATION_ERROR', message: 'Invalid request.' }, 400);
  }
  const result = await backend('/auth/' + action, 'POST', token, body);

  if (
    action === 'login' &&
    result.status === 503 &&
    result.data &&
    typeof result.data === 'object' &&
    'code' in result.data &&
    result.data.code === 'RATE_LIMITED'
  ) {
    const retryAfter =
      'retryAfter' in result.data &&
      typeof result.data.retryAfter === 'number' &&
      Number.isInteger(result.data.retryAfter)
        ? Math.max(1, Math.min(3600, result.data.retryAfter))
        : 60;
    const response = reply(
      { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait before retrying.' },
      429
    );

    response.headers.set('Retry-After', String(retryAfter));
    return response;
  }
  if (action === 'request-password-reset' || action === 'reset-password') {
    const data = result.data as { message?: unknown; code?: unknown; retryAfter?: unknown } | null;

    if (data?.code === 'RATE_LIMITED') {
      const response = reply({ message: 'Too many attempts. Please wait before retrying.' }, 429);

      response.headers.set('Retry-After', String(typeof data.retryAfter === 'number' ? data.retryAfter : 60));
      return response;
    }
    const status = [200, 400, 503].includes(result.status) ? result.status : 503;
    const message =
      status === 200
        ? action === 'request-password-reset'
          ? 'If an active manager account matches, a code will be emailed. Check your inbox and spam folder.'
          : 'Password changed. Sign in with your new password.'
        : status === 400 && action === 'reset-password'
          ? data?.message === 'Choose a different password from your current password.'
            ? data.message
            : 'The code is invalid or expired, or the password is invalid. Please check your details.'
          : 'Password reset is unavailable. Please try again later.';
    const response = reply({ message }, status);

    if (status === 200 && action === 'reset-password') response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  if (action === 'logout') {
    // Retain the cookie on failure so the user can retry durable revocation.
    const signedOut = result.status === 200 || result.status === 401;
    const response = reply({ code: signedOut ? 'SIGNED_OUT' : 'SERVICE_UNAVAILABLE' }, signedOut ? 200 : 503);

    if (signedOut) response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  if (
    result.status !== 200 ||
    !isSession(result.data) ||
    !('accessToken' in result.data) ||
    typeof result.data.accessToken !== 'string'
  ) {
    const status = [400, 401, 403].includes(result.status) ? result.status : 503;

    return reply(
      {
        code: status === 503 ? 'SERVICE_UNAVAILABLE' : 'AUTHENTICATION_FAILED',
        message:
          status === 503
            ? 'Sign-in service unavailable. Please retry.'
            : 'Unable to sign in. Check your details and try again.'
      },
      status
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
    maxAge: Math.max(0, session.expiresAt - Math.floor(Date.now() / 1000))
  });
  return response;
}
