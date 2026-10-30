'use client';

import { useEffect, useRef } from 'react';
import { subscribeRealtime } from '@/lib/realtime-connection';

export function useRealtimeRefresh(scope: 'analytics' | 'food' | undefined, refresh: () => void) {
  const latest = useRef(refresh);

  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    if (!scope) return;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      pending ??= setTimeout(() => {
        pending = undefined;
        latest.current();
      }, 250);
    };
    const stop = subscribeRealtime(name => {
      if (name === 'live.connected' || name === (scope === 'food' ? 'food.analytics.changed' : 'analytics.changed'))
        schedule();
    });
    const timer = setInterval(schedule, 30000);

    return () => {
      stop();
      clearInterval(timer);
      clearTimeout(pending);
    };
  }, [scope]);
}
