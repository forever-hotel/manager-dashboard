'use client';
import { useEffect, useRef, useState } from 'react';
import { Sidebar } from './Sidebar';
import { SessionBoundary } from './SessionBoundary';
import { Session } from '@/lib/auth';
export function ClientLayout({
  children,
  session,
}: {
  children: React.ReactNode;
  session: Session;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const trigger = toggle.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const navigation = document.getElementById('dashboard-navigation');
    const controls = () =>
      Array.from(
        navigation?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled])',
        ) ?? [],
      );
    controls()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key !== 'Tab') return;
      const items = [trigger, ...controls()].filter(
        (item): item is HTMLElement => item !== null,
      );
      const first = items[0];
      const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    const resize = () => {
      if (window.innerWidth >= 768) setOpen(false);
    };
    document.addEventListener('keydown', keyboard);
    window.addEventListener('resize', resize);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keyboard);
      window.removeEventListener('resize', resize);
      trigger?.focus();
    };
  }, [open]);
  return (
    <SessionBoundary session={session}>
      <a
        href="#dashboard-content"
        className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-white focus:p-4"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-50 grid h-16 grid-cols-[44px_1fr_44px] items-center gap-2 border-b border-gray-200 bg-white px-3 md:hidden">
        <button
          ref={toggle}
          type="button"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          aria-controls="dashboard-navigation"
          onClick={() => setOpen((value) => !value)}
          className="flex h-11 w-11 items-center justify-center rounded-md text-black hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
        >
          <svg
            aria-hidden="true"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          >
            <path
              d={open ? 'M6 6l12 12M6 18L18 6' : 'M4 6h16M4 12h16M4 18h16'}
            />
          </svg>
        </button>
        <div className="min-w-0 text-center leading-tight">
          <div className="text-[13px] font-medium text-black">
            Forever Hotel
          </div>
          <div className="text-[10px] font-normal text-black/60">
            Manager Dashboard
          </div>
        </div>
      </header>
      {open && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-x-0 bottom-0 top-16 z-30 bg-black/30 md:hidden"
        />
      )}
      <div className="md:flex w-full min-h-screen bg-white text-black">
        <Sidebar
          open={open}
          close={() => setOpen(false)}
          username={session.username}
        />
        <div
          id="dashboard-content"
          tabIndex={-1}
          className="flex-1 min-w-0 md:pl-[220px]"
        >
          {children}
        </div>
      </div>
    </SessionBoundary>
  );
}
