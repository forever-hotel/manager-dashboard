'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export const navigation = [
  ['Analytics', '/analytics'],
  ['Rooms', '/rooms'],
  ['Promotions', '/promotions'],
  ['Staff', '/staff'],
  ['Notifications', '/notifications'],
  ['Complaints', '/complaints'],
  ['Food Orders', '/food-orders'],
  ['Service Requests', '/service-requests'],
  ['Worker Performance', '/worker-performance'],
  ['Tasks', '/tasks'],
  ['Reports', '/reports'],
  ['Settings', '/settings'],
];
export function Sidebar({
  open,
  close,
  username,
}: {
  open: boolean;
  close: () => void;
  username: string;
}) {
  const pathname = usePathname();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    setError('');
    try {
      const result = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) throw new Error();
      window.location.replace('/login');
    } catch {
      setError('Sign out could not finish. Please retry.');
    } finally {
      setPending(false);
    }
  }
  return (
    <aside
      id="dashboard-navigation"
      className={`${open ? 'block' : 'hidden'} md:block md:fixed md:inset-y-0 md:left-0 md:w-[220px] overflow-y-auto border-r border-gray-200 bg-white p-4`}
    >
      <div className="mb-5 border-b pb-4">
        <p className="font-semibold">Forever Hotel</p>
        <p className="text-sm text-gray-600">Manager Dashboard</p>
      </div>
      <nav aria-label="Dashboard">
        <ul className="space-y-1">
          {navigation.map(([name, href]) => (
            <li key={href}>
              <Link
                href={href}
                prefetch={false}
                onClick={close}
                aria-current={pathname === href ? 'page' : undefined}
                className={`block rounded p-2 text-sm ${pathname === href ? 'bg-gray-100 font-semibold' : 'hover:bg-gray-50'}`}
              >
                {name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mt-6 border-t pt-4">
        <p className="break-words text-sm">{username}</p>
        <button
          onClick={() => void logout()}
          disabled={pending}
          className="mt-3 rounded border px-3 py-2 text-sm"
        >
          {pending ? 'Signing out…' : 'Sign out'}
        </button>
        {error && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
