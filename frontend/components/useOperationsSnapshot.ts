'use client';

import { useEffect, useState } from 'react';
import { z } from 'zod';
import { subscribeRealtime, retryRealtime } from '@/lib/realtime-connection';

export function useOperationsSnapshot<T>(url: string, schema: z.ZodType<T>, healthEvent: string, changeEvent: string) {
  const [result, setResult] = useState<{ url: string; data: T } | null>(null);
  const [message, setMessage] = useState('Loading...');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stopped = false,
      loading = false,
      dirty = false,
      healthy = false,
      denied = false;
    const controller = new AbortController();
    async function refresh() {
      if (stopped || denied) return;
      if (loading) {
        dirty = true;
        return;
      }
      loading = true;
      try {
        const response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });

        if (stopped || denied) return;
        if ([401, 403].includes(response.status)) {
          denied = true;
          setResult(null);
          setMessage(response.status === 401 ? 'Please sign in again.' : 'Manager access is required.');
          return;
        }
        if (!response.ok) throw new Error();
        const data = schema.parse(await response.json());

        if (!stopped && !denied) {
          setResult({ url, data });
          setMessage(healthy ? '' : 'Live updates unavailable. Showing the last snapshot.');
        }
      } catch {
        if (!stopped && !denied) setMessage('Data is stale or unavailable. Retry to refresh.');
      } finally {
        loading = false;
        if (dirty && !stopped) {
          dirty = false;
          void refresh();
        }
      }
    }
    const stop = subscribeRealtime((name, data) => {
      if (name === 'live.denied') {
        denied = true;
        setResult(null);
        setMessage(data === 401 ? 'Please sign in again.' : 'Manager access is required.');
      } else if (name === healthEvent) {
        const previous = healthy;

        healthy = Boolean(data && typeof data === 'object' && 'healthy' in data && data.healthy === true);
        if (!healthy) setMessage('Live updates unavailable. Showing the last snapshot.');
        if (healthy !== previous) void refresh();
      } else if (name === changeEvent || name === 'live.connected') void refresh();
      else if (name === 'live.offline') {
        healthy = false;
        setMessage('Data may be stale. Reconnecting...');
      } else if (name === 'live.exhausted') {
        healthy = false;
        setMessage('Live updates offline after five attempts. Retry to reconnect.');
      }
    });

    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 30000);

    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      stop();
    };
  }, [url, schema, healthEvent, changeEvent, attempt]);
  return {
    snapshot: result?.url === url ? result.data : null,
    message,
    retry: () => {
      retryRealtime();
      setAttempt(n => n + 1);
    }
  };
}
