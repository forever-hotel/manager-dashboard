'use client';

import { useEffect, useRef, useState } from 'react';
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
      { name: 'Worker performance', href: '/worker-performance' }
    ]
  }
];

export function Sidebar({ open, close, username }: { open: boolean; close: () => void; username: string }) {
  const pathname = usePathname();
  const notifications = useNotifications();
  const [pending, setPending] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const account = useRef<HTMLDivElement>(null);
  function closeMenus() {
    setAccountOpen(false);
    close();
  }
  useEffect(() => {
    if (!accountOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!account.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [accountOpen]);
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
      className={`${open ? 'flex' : 'hidden'} dashboard-sidebar`}
      onKeyDown={event => {
        if (event.key === 'Escape' && accountOpen) {
          setAccountOpen(false);
          event.currentTarget.querySelector<HTMLButtonElement>('.account-trigger')?.focus();
        }
      }}
    >
      <div className="sidebar-brand">
        <div>Forever Hotel</div>
        <span>Manager Dashboard</span>
      </div>
      <nav aria-label="Dashboard" className="sidebar-groups">
        {groups.map(group => (
          <div key={group.label} className="sidebar-group">
            <div className="sidebar-group-label">{group.label}</div>
            {group.items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onClick={closeMenus}
                aria-current={pathname === item.href ? 'page' : undefined}
                className="sidebar-link"
              >
                <span className="sidebar-dot" />
                <span>{item.name}</span>
                {item.href === '/complaints' && !!notifications?.snapshot?.counts.complaints && (
                  <span className="complaint-count" title="Unresolved complaints across all dates">
                    {notifications.snapshot.counts.complaints}
                  </span>
                )}
              </Link>
            ))}
          </div>
        ))}
      </nav>
      <div ref={account} className="sidebar-account">
        {accountOpen && (
          <nav className="account-menu" aria-label="Account tools">
            <Link href="/notifications" prefetch={false} onClick={closeMenus}>
              Notifications
            </Link>
            <Link href="/tasks" prefetch={false} onClick={closeMenus}>
              Task queue
            </Link>

            <button type="button" disabled={pending} onClick={() => void logout()}>
              {pending ? 'Signing out...' : 'Logout'}
            </button>
          </nav>
        )}
        <button
          type="button"
          className="account-trigger"
          aria-label="Open account menu"
          aria-expanded={accountOpen}
          onClick={() => setAccountOpen(value => !value)}
        >
          <span className="account-avatar">{username.slice(0, 2).toUpperCase()}</span>
          <span className="account-copy">
            <span>{username}</span>
            <small>Manager</small>
          </span>
        </button>
        {error && (
          <p role="alert" className="sidebar-error">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
