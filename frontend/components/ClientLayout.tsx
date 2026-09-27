'use client';
import { useState } from 'react';
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
  return (
    <SessionBoundary session={session}>
      <a
        href="#dashboard-content"
        className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-white focus:p-4"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b bg-white p-3 md:hidden">
        <button
          aria-expanded={open}
          aria-controls="dashboard-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? 'Close navigation' : 'Open navigation'}
        </button>
      </header>
      <div className="min-h-screen bg-white text-black">
        <Sidebar
          open={open}
          close={() => setOpen(false)}
          username={session.username}
        />
        <div
          id="dashboard-content"
          tabIndex={-1}
          className="min-w-0 md:pl-[220px]"
        >
          {children}
        </div>
      </div>
    </SessionBoundary>
  );
}
