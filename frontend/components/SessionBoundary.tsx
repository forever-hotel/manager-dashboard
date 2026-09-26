'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isSession, safeDestination, Session } from '@/lib/auth';

function loginDestination() {
  return (
    '/login?reason=expired&next=' +
    encodeURIComponent(
      safeDestination(window.location.pathname + window.location.search),
    )
  );
}

export function SessionBoundary({
  session,
  children,
}: {
  session: Session;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<'ready' | 'checking' | 'unavailable'>(
    'ready',
  );
  const check = useCallback(async () => {
    setState('checking');
    try {
      const result = await fetch('/api/auth/session', {
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (result.status === 401 || result.status === 403) {
        window.location.replace(loginDestination());
        return;
      }
      if (!result.ok) throw new Error();
      const current: unknown = await result.json();
      if (!isSession(current)) throw new Error();
      if (current.passwordChangeRequired) {
        window.location.replace(
          '/change-password?next=' +
            encodeURIComponent(
              safeDestination(
                window.location.pathname + window.location.search,
              ),
            ),
        );
        return;
      }
      setState('ready');
    } catch {
      setState('unavailable');
    }
  }, []);
  useEffect(() => {
    const expire = window.setTimeout(
      () => {
        setState('checking');
        window.location.replace(loginDestination());
      },
      Math.max(0, session.expiresAt * 1000 - Date.now()),
    );
    const poll = window.setInterval(() => {
      void check();
    }, 60000);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setState('checking');
      else void check();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        void check();
        router.refresh();
      }
    };
    const onPageHide = () => setState('checking');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      clearTimeout(expire);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [check, router, session.expiresAt]);
  if (state !== 'ready')
    return (
      <main className="p-8" role="status">
        {state === 'checking' ? (
          'Checking your session…'
        ) : (
          <>
            Service unavailable.{' '}
            <button className="underline" onClick={() => void check()}>
              Retry
            </button>
          </>
        )}
      </main>
    );
  return children;
}
