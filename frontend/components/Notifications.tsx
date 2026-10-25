'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { notificationsSchema, type NotificationItem } from '@/lib/notifications';
import { useOperationsSnapshot } from './useOperationsSnapshot';
function useNotificationsState() {
  const [page, setPage] = useState(1);
  const live = useOperationsSnapshot(
    '/api/notifications?' + new URLSearchParams({ page: String(page), pageSize: '20' }),
    notificationsSchema,
    'notifications.transport.status',
    'notifications.changed'
  );
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const lock = useRef(false);
  async function markRead(item: NotificationItem) {
    if (lock.current) return;
    lock.current = true;
    setBusy(item.id);
    setError('');
    try {
      const result = await fetch('/api/notifications/' + item.type + '/' + item.sourceId + '/read', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: item.revision }),
        signal: AbortSignal.timeout(8000)
      });
      if ([401, 403].includes(result.status)) {
        setDenied(true);
        throw new Error('Please sign in again.');
      }
      if (!result.ok)
        throw new Error(
          result.status === 409
            ? 'The alert changed. Refresh before marking it read.'
            : 'Unable to mark read. Retry after refreshing.'
        );
      live.retry();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to mark read.');
    } finally {
      lock.current = false;
      setBusy(undefined);
    }
  }
  return {
    ...live,
    snapshot: denied ? null : live.snapshot,
    page,
    setPage,
    markRead,
    busy,
    error
  };
}
const NotificationsContext = createContext<ReturnType<typeof useNotificationsState> | null>(null);
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const value = useNotificationsState();
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
export function useNotifications() {
  return useContext(NotificationsContext);
}
const button = 'font-normal text-xs text-ink underline focus-visible:outline-2 focus-visible:outline-offset-2';
export function NotificationsBanner() {
  const state = useNotifications();
  if (!state) return null;
  return (
    <section
      aria-label="Current alerts"
      className="mx-8 mt-6 rounded-lg border border-accent bg-accent-light p-4 text-[13px]"
    >
      {state.snapshot ? (
        <>
          <p role="status">
            {state.snapshot.total} active alerts: {state.snapshot.counts.complaints} unresolved complaints,{' '}
            {state.snapshot.counts.stock} stock problems.{' '}
            <a className={button} href="/notifications">
              View notifications
            </a>
          </p>
          {state.snapshot.items.slice(0, 3).map(item => (
            <a key={item.id} href={item.href} className="mr-4 underline">
              {item.title}
            </a>
          ))}
        </>
      ) : (
        <p role="status">Alert count unavailable until notifications load.</p>
      )}
      {state.message && (
        <p role="status">
          {state.message}{' '}
          <button type="button" className={button + ' button button-secondary'} onClick={state.retry}>
            Refresh alerts
          </button>
        </p>
      )}
    </section>
  );
}
export default function NotificationsPanel({ initialPage = 1 }: { initialPage?: number }) {
  const state = useNotifications();
  const setPage = state?.setPage;
  useEffect(() => {
    setPage?.(initialPage);
  }, [initialPage, setPage]);
  if (!state) return <p role="alert">Notifications are unavailable.</p>;
  const data = state.snapshot;
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      <h1 className="mb-6 font-medium text-[22px] text-brand">Notifications</h1>
      <p className="text-[13px] mb-4">Reading an alert does not resolve its underlying issue.</p>
      {state.message && (
        <p role="status" className="text-[13px] mb-3">
          {state.message}{' '}
          <button className={button + ' button button-secondary'} onClick={state.retry}>
            Retry notifications
          </button>
        </p>
      )}
      {state.error && <p role="alert">{state.error}</p>}
      {data && (
        <>
          <p role="status" className="text-[13px] mb-4">
            {data.total} active alerts; {data.unread} unread. Counts include every page.
          </p>
          {data.total === 0 && <p>No active complaints or stock problems.</p>}
          <ul className="space-y-3">
            {data.items.map(item => (
              <li
                id={(item.type === 'STOCK' ? 'stock-' : 'complaint-') + item.sourceId}
                key={item.id}
                className="border border-border rounded-lg p-4 text-[13px] bg-surface"
              >
                <h2 className="font-medium text-base text-ink">{item.title}</h2>
                <p>
                  {item.status.replaceAll('_', ' ')} · {item.isRead ? 'Read' : 'Unread'}
                </p>
                <p>
                  {new Date(item.occurredAt).toLocaleString('en-GB', {
                    timeZone: 'Asia/Colombo'
                  })}{' '}
                  · Asia/Colombo
                </p>
                <p>Reference: {item.sourceId}</p>
                <a className={button} href={item.href}>
                  {item.type === 'COMPLAINT' ? 'View complaint details' : 'View stock alert details'}
                </a>
                {!item.isRead && (
                  <button
                    type="button"
                    className={button + ' ml-4' + ' button button-secondary'}
                    disabled={!!state.busy}
                    onClick={() => void state.markRead(item)}
                  >
                    {state.busy === item.id ? 'Saving…' : 'Mark read'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <nav aria-label="Notification pages" className="flex gap-4 mt-4 text-[13px]">
            <button
              disabled={state.page === 1}
              onClick={() => state.setPage(p => p - 1)}
              className="button button-secondary"
            >
              Previous alerts
            </button>
            <span>Page {state.page}</span>
            <button
              disabled={state.page * 20 >= data.total}
              onClick={() => state.setPage(p => p + 1)}
              className="button button-secondary"
            >
              Next alerts
            </button>
          </nav>
        </>
      )}
    </main>
  );
}
