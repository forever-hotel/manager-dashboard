'use client';

import Link from 'next/link';
import { useNotifications } from './Notifications';

export default function HeaderNotifications() {
  const notifications = useNotifications();
  const unread = notifications?.snapshot?.unread;

  return (
    <Link className="header-notifications" href="/notifications" aria-label="Open notifications" prefetch={false}>
      <svg
        aria-hidden="true"
        width="21"
        height="23"
        viewBox="0 0 24 26"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M4 19h16l-2-3V10a6 6 0 0 0-12 0v6l-2 3Z" />
        <path d="M9 22a3 3 0 0 0 6 0M12 2v2" />
      </svg>
      {!!unread && (
        <span className="notification-dot">
          <span className="sr-only">{unread} unread</span>
        </span>
      )}
    </Link>
  );
}
