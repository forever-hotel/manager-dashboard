'use client';
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { z } from 'zod';

export function useOperationsSnapshot<T>(url: string, schema: z.ZodType<T>, healthEvent: string, changeEvent: string) {
  const [result, setResult] = useState<{ url: string; data: T } | null>(null);
  const [message, setMessage] = useState('Loading...');
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

    const failure = (status: number) => {
      if (status === 401 || status === 403) {
        authFailed = true;
        clearTimeout(timer);
        socket?.removeAllListeners();
        socket?.disconnect();
        setResult(null);
        setMessage(status === 401 ? 'Please sign in again.' : 'Manager access is required.');
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
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal
        });
        if (stopped || authFailed) return;
        if (failure(response.status)) return;
        if (!response.ok) throw new Error();
        const data = schema.parse(await response.json());
        if (stopped || authFailed) return;
        setResult({ url, data });
        setMessage(
          healthy
            ? ''
            : exhausted
              ? 'Live updates offline after five attempts. Retry to reconnect.'
              : 'Live updates unavailable. Showing the last snapshot.'
        );
      } catch {
        if (!stopped && !authFailed) setMessage('Data is stale or unavailable. Retry to refresh.');
      } finally {
        loading = false;
        if (dirty && !stopped) {
          dirty = false;
          void refresh();
        }
      }
    }
    function schedule() {
      if (stopped || authFailed || timer) return;
      healthy = false;
      setMessage('Data may be stale. Reconnecting...');
      if (attempt >= 5) {
        exhausted = true;
        setMessage('Live updates offline after five attempts. Retry to reconnect.');
        return;
      }
      timer = setTimeout(
        () => {
          timer = undefined;
          void connect();
        },
        Math.min(1000 * 2 ** attempt, 16000)
      );
      attempt++;
    }
    async function connect() {
      if (stopped || authFailed) return;
      try {
        socket?.removeAllListeners();
        socket?.disconnect();
        const response = await fetch('/api/realtime/ticket', {
          method: 'POST',
          credentials: 'same-origin',
          signal: controller.signal
        });
        if (stopped || failure(response.status)) return;
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
          timeout: 7000
        });
        socket.on('connect', () => {
          attempt = 0;
          exhausted = false;
          void refresh();
        });
        socket.on(healthEvent, (data: unknown) => {
          const next = typeof data === 'object' && data !== null && (data as { healthy?: unknown }).healthy === true;
          const changed = healthy !== next;
          healthy = next;
          if (!healthy) setMessage('Live updates unavailable. Showing the last snapshot.');
          if (changed) void refresh();
        });
        socket.on(changeEvent, (raw: unknown) => {
          // Events are invalidations only: always reread the authoritative snapshot.
          // Coalescing below prevents overlapping reads; no producer payload is rendered.
          void raw;
          void refresh();
        });
        socket.on('disconnect', schedule);
        socket.on('connect_error', schedule);
      } catch {
        if (!stopped) schedule();
      }
    }
    void refresh();
    void connect();
    // Reconcile missed events without changing the current filters or page.
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
  }, [url, retry, schema, healthEvent, changeEvent]);
  return {
    snapshot: result?.url === url ? result.data : null,
    message,
    retry: () => setRetry(n => n + 1)
  };
}
