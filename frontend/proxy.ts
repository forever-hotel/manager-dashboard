import { NextRequest, NextResponse } from 'next/server';
import { backend } from './lib/backend';
import { isSession, SESSION_COOKIE } from './lib/auth';

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (['/', '/login', '/unavailable'].includes(path))
    return NextResponse.next();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const result = token ? await backend('/auth/session', 'GET', token) : null;
  let target: string | undefined;
  if (result && result.status >= 500) target = '/unavailable';
  else if (!result || result.status !== 200 || !isSession(result.data))
    target = '/login';
  else if (result.data.passwordChangeRequired && path !== '/change-password')
    target = '/change-password';
  if (target) {
    const url = new URL(target, request.url);
    url.searchParams.set('next', path + request.nextUrl.search);
    if (target === '/login' && token) url.searchParams.set('reason', 'expired');
    const response = NextResponse.redirect(url);
    response.headers.set('Cache-Control', 'no-store');
    if (target === '/login') response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  const response = NextResponse.next();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/((?!api/|_next/|favicon.ico).*)'] };
