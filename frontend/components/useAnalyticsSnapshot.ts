'use client';
import { useEffect, useState } from 'react';
import { z } from 'zod';
export function useAnalyticsSnapshot<T>(url: string, schema: z.ZodType<T>, enabled = true) {
  const [state, setState] = useState<{ url: string; data?: T; error?: number }>({ url });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal
        });
        if (!response.ok) {
          if (active) setState({ url, error: response.status });
          return;
        }
        const data = schema.parse(await response.json());
        if (active) setState({ url, data });
      } catch {
        if (active) setState({ url, error: 503 });
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [url, schema, attempt, enabled]);
  const current = state.url === url ? state : undefined;
  return {
    data: current?.data,
    error: current?.error,
    retry: () => {
      setState({ url });
      setAttempt(n => n + 1);
    }
  };
}
