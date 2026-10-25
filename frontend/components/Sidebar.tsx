'use client';

import React, { useRef, useState } from 'react';
import { replaceLocation } from '@/lib/navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useNotifications } from './Notifications';

const groups: {
  label: string;
  items: { name: string; href: string; badge?: number }[];
}[] = [
  {
    label: 'Overview',
    items: [
      { name: 'Analytics', href: '/analytics' },
      { name: 'Room status', href: '/rooms' }
    ]
  },
  {
    label: 'Operations',
    items: [
      { name: 'Food orders', href: '/food-orders' },
      { name: 'Service requests', href: '/service-requests' },
      { name: 'Complaints', href: '/complaints' }
    ]
  },
  {
    label: 'Management',
    items: [
      { name: 'Promotions', href: '/promotions' },
      { name: 'Staff accounts', href: '/staff' },
      { name: 'Worker performance', href: '/worker-performance' },
      { name: 'Notifications', href: '/notifications' },
      { name: 'Tasks', href: '/tasks' },
      { name: 'Reports', href: '/reports' },
      { name: 'Settings', href: '/settings' }
    ]
  }
];

export function Sidebar({ open, close, username }: { open: boolean; close: () => void; username: string }) {
  const pathname = usePathname();
  const notifications = useNotifications();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  async function logout() {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw new Error();
      replaceLocation('/login');
    } catch {
      locked.current = false;
      setPending(false);
      setError('Sign out could not finish. Please retry.');
    }
  }

  return (
    <aside
      id="dashboard-navigation"
      className={`${open ? 'flex' : 'hidden'} dashboard-sidebar fixed bottom-0 left-0 top-16 z-40 w-[min(280px,85vw)] shrink-0 flex-col justify-between overflow-y-auto overscroll-contain border-r border-brand bg-sidebar text-sidebar-foreground shadow-xl md:top-0 md:flex md:h-screen md:w-[220px] md:shadow-none`}
    >
      <div>
        {/* Logo */}
        <div className="hidden px-5 pt-6 pb-6 border-b border-brand md:block">
          <div className="font-medium text-[13px] text-sidebar-foreground">Forever Hotel</div>
          <div className="font-normal text-xs text-sidebar-muted">Manager Dashboard</div>
        </div>

        {/* Navigation */}
        <nav aria-label="Dashboard" className="px-3 pt-5 space-y-6">
          {groups.map(group => (
            <div key={group.label}>
              <div className="font-medium text-xs underline text-sidebar-foreground px-2 mb-2">{group.label}</div>
              <div className="space-y-1">
                {group.items.map(item => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      prefetch={false}
                      onClick={close}
                      aria-current={isActive ? 'page' : undefined}
                      aria-label={
                        item.href === '/notifications' && notifications
                          ? 'Notifications ' + (notifications.snapshot?.total ?? '?')
                          : undefined
                      }
                      className={`flex items-center justify-between w-full min-h-10 rounded-md border-l-2 px-2 transition-colors ${
                        isActive ? 'bg-brand border-accent' : 'border-transparent hover:bg-brand'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-accent' : 'bg-sidebar-muted'}`} />
                        <span
                          className={`text-[13px] text-sidebar-foreground ${isActive ? 'font-medium' : 'font-normal'}`}
                        >
                          {item.name}
                        </span>
                      </div>
                      {((item.href === '/notifications' && notifications) ||
                        ('badge' in item && item.badge != null)) && (
                        <span
                          className={`text-xs text-sidebar-foreground rounded-full w-5 h-5 flex items-center justify-center ${
                            isActive ? 'font-medium bg-brand-hover border border-brand' : 'font-normal bg-brand'
                          }`}
                        >
                          {item.href === '/notifications' && notifications
                            ? (notifications.snapshot?.total ?? '?')
                            : item.badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* User footer */}
      <div>
        <div className="flex items-center gap-2 px-5 py-4 border-t border-brand">
          <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center">
            <span className="font-medium text-xs text-sidebar-foreground">{username.slice(0, 2).toUpperCase()}</span>
          </div>
          <div className="leading-tight">
            <div className="text-xs text-sidebar-foreground">{username}</div>
            <div className="text-xs text-sidebar-muted">Manager</div>
          </div>
        </div>
        <div className="px-5 pb-4">
          <button
            type="button"
            onClick={() => void logout()}
            disabled={pending}
            className="w-full border border-brand rounded-md py-2 text-[13px] text-sidebar-foreground hover:bg-brand disabled:opacity-50 button button-ghost"
          >
            {pending ? 'Signing out...' : 'Logout'}
          </button>
          {error && (
            <p role="alert" className="text-xs text-danger-light mt-2">
              {error}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
