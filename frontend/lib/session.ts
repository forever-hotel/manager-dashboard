import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { backend } from './backend';
import { isSession, SESSION_COOKIE } from './auth';

export async function requireSession(allowPasswordChange = false) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');
  const result = await backend('/auth/session', 'GET', token);
  if (result.status >= 500) redirect('/unavailable');
  if (result.status !== 200 || !isSession(result.data))
    redirect('/login?reason=expired');
  if (result.data.passwordChangeRequired && !allowPasswordChange)
    redirect('/change-password');
  return result.data;
}
