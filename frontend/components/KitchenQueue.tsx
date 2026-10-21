'use client';
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  KitchenSnapshot,
  KitchenStatus,
  KitchenVersions,
  kitchenEventSchema,
  kitchenLabels,
  kitchenSnapshotSchema,
} from '@/lib/kitchen';

export default function KitchenQueue() {
  const [snapshot, setSnapshot] = useState<KitchenSnapshot | null>(null);
  const [message, setMessage] = useState('Loading kitchen orders...');
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false,
      socket: Socket | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      attempt = 0,
      loading = false,
      dirty = false,
      healthy = false,
      exhausted = false,
      authFailed = false;
    const controller = new AbortController();
    const versions = new KitchenVersions();
    const failure = (status: number) => {
      if (status === 401 || status === 403) {
        authFailed = true;
        clearTimeout(timer);
        socket?.removeAllListeners();
        socket?.disconnect();
        setSnapshot(null);
        setMessage(
          status === 401
            ? 'Please sign in again.'
            : 'Manager access is required.',
        );
        return true;
      }
      return false;
    };
    async function refresh() {
      if (stopped || authFailed) return;
      if (loading) {
        dirty = true;
        return;
      }
      loading = true;
      try {
        const response = await fetch(
          '/api/kitchen/orders?page=' + page + '&pageSize=100',
          {
            cache: 'no-store',
            credentials: 'same-origin',
            signal: controller.signal,
          },
        );
        if (stopped || authFailed) return;
        if (failure(response.status)) return;
        if (!response.ok) throw new Error();
        const data = kitchenSnapshotSchema.parse(await response.json());
        if (stopped || authFailed) return;
        setSnapshot(data);
        setMessage(
          healthy
            ? ''
            : exhausted
              ? 'Live updates offline after five attempts. Retry to reconnect.'
              : 'Live updates unavailable. Showing the last snapshot.',
        );
      } catch {
        if (!stopped && !authFailed)
          setMessage('Kitchen data is stale or unavailable. Retry to refresh.');
      } finally {
        loading = false;
        if (dirty && !stopped && !authFailed) {
          dirty = false;
          void refresh();
        }
      }
    }
    function schedule() {
      if (stopped || authFailed || timer) return;
      healthy = false;
      setMessage('Kitchen data may be stale. Reconnecting...');
      if (attempt >= 5) {
        exhausted = true;
        setMessage(
          'Live updates offline after five attempts. Retry to reconnect.',
        );
        return;
      }
      timer = setTimeout(
        () => {
          timer = undefined;
          void connect();
        },
        Math.min(1000 * 2 ** attempt, 16000),
      );
      attempt++;
    }
    async function connect() {
      if (stopped || authFailed) return;
      try {
        socket?.removeAllListeners();
        socket?.disconnect();
        const response = await fetch('/api/kitchen/ticket', {
          method: 'POST',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (stopped || authFailed || failure(response.status)) return;
        if (!response.ok) throw new Error();
        const data = (await response.json()) as {
          ticket: string;
          socketUrl: string;
        };
        if (stopped || authFailed) return;
        socket = io(data.socketUrl, {
          path: '/mad/socket.io',
          transports: ['websocket'],
          auth: { ticket: data.ticket },
          reconnection: false,
          timeout: 7000,
        });
        socket.on('connect', () => {
          attempt = 0;
          exhausted = false;
          void refresh();
        });
        socket.on('transport.status', (data: unknown) => {
          const next =
            typeof data === 'object' &&
            data !== null &&
            (data as { healthy?: unknown }).healthy === true;
          const changed = healthy !== next;
          healthy = next;
          if (!healthy)
            setMessage('Live updates unavailable. Showing the last snapshot.');
          if (changed) void refresh();
        });
        socket.on('kitchen.order.changed', (raw: unknown) => {
          const event = kitchenEventSchema.safeParse(raw);
          if (!event.success) {
            setMessage('Kitchen data may be stale. Refreshing...');
            void refresh();
            return;
          }
          if (versions.accept(event.data)) void refresh();
        });
        socket.on('disconnect', schedule);
        socket.on('connect_error', schedule);
      } catch {
        if (!stopped) schedule();
      }
    }
    void refresh();
    void connect();
    // Repairs missed invalidations and rolls the delivered-day window at midnight.
    const reconciliation = setInterval(() => {
      void refresh();
    }, 30000);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      clearInterval(reconciliation);
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [page, retry]);
  const group = (status: KitchenStatus) => (
    <div key={status} aria-label={kitchenLabels[status]}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-[10px] text-black">
          {kitchenLabels[status]}
        </span>
        <span className="font-medium text-[9.5px] text-black bg-white border border-gray-200 rounded-full w-5 h-5 flex items-center justify-center">
          {snapshot ? snapshot.counts[status] : '—'}
        </span>
      </div>
      <div className="space-y-2">
        {snapshot?.orders
          .filter((o) => o.status === status)
          .map((order) => (
            <div
              key={order.id}
              className="bg-white rounded-md p-2.5 border border-gray-100"
            >
              <div className="font-medium text-[10.5px] text-black">
                Room {order.roomNumber}
              </div>
              <div className="font-normal text-[9px] text-black/60">
                {order.mealPeriod} · {order.itemCount} items
              </div>
              <div className="font-normal text-[9px] text-black/60">
                Order {order.id}
              </div>
            </div>
          ))}
        {snapshot && !snapshot.orders.some((o) => o.status === status) && (
          <p className="font-normal text-[9px] text-black/60">
            No orders on this page.
          </p>
        )}
      </div>
    </div>
  );
  return (
    <section className="col-span-2 border border-gray-200 rounded-lg p-4">
      <h2 className="font-medium text-[11.5px] text-black mb-3">
        Kitchen queue (live)
      </h2>
      {message && (
        <div
          role="status"
          className="font-normal text-[9.5px] text-black/60 mb-3"
        >
          {message}{' '}
          <button
            type="button"
            className="underline"
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry
          </button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-50 rounded-md p-3">{group('PLACED')}</div>
        <div className="bg-gray-50 rounded-md p-3">
          {group('IN_PREPARATION')}
        </div>
        <div className="bg-gray-50 rounded-md p-3 space-y-3">
          {group('READY')}
          {group('DELIVERED')}
        </div>
      </div>
      {snapshot && (
        <div className="font-normal text-[9px] text-black/60 mt-3">
          Delivered: today (Asia/Colombo). Page {page} of{' '}
          {Math.max(1, Math.ceil(snapshot.total / 100))}.{' '}
          <button
            type="button"
            className="underline"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </button>{' '}
          <button
            type="button"
            className="underline"
            disabled={page * 100 >= snapshot.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
