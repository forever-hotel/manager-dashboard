'use client';
import { useEffect } from 'react';
import { safeDestination, type Session } from '@/lib/auth';
import { replaceLocation } from '@/lib/navigation';

export function SessionBoundary({ session, children }: { session: Session; children: React.ReactNode }) {
  useEffect(() => {
    const expire = window.setTimeout(
      () => {
        replaceLocation(
          '/login?reason=expired&next=' +
            encodeURIComponent(safeDestination(window.location.pathname + window.location.search))
        );
      },
      Math.max(0, session.expiresAt * 1000 - Date.now())
    );
    return () => clearTimeout(expire);
  }, [session.expiresAt]);
  return children;
}
