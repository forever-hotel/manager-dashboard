'use client';

import { useEffect, useState } from 'react';
import { useRealtimeRefresh } from './useRealtimeRefresh';
import { AnalyticsError } from '@/lib/analytics';
import { loadLowDemand, type LowDemand } from '@/lib/low-demand';

export default function LowDemandAlerts() {
  const [data, setData] = useState<LowDemand>();
  const [error, setError] = useState<number>();
  const [attempt, setAttempt] = useState(0);

  useRealtimeRefresh('analytics', () => setAttempt(value => value + 1));
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    loadLowDemand(controller.signal)
      .then(value => {
        if (active) {
          setData(value);
          setError(undefined);
        }
      })
      .catch(reason => {
        if (active) setError(reason instanceof AnalyticsError ? reason.status : 503);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);
  return (
    <div
      className="demand-strip"
      role={error ? 'alert' : 'status'}
      title="Forecast for the next 14 days, independent of the selected reporting period."
    >
      {error ? (
        <>
          {error === 401
            ? 'Your session ended.'
            : error === 403
              ? 'Low-demand alerts are not permitted for this account.'
              : 'Low-demand information is unavailable. Demand is unknown.'}{' '}
          {error === 401 && <a href="/login">Sign in</a>}
          {error !== 401 && error !== 403 && (
            <button
              type="button"
              aria-label="Retry low-demand alerts"
              onClick={() => {
                setError(undefined);
                setData(undefined);
                setAttempt(n => n + 1);
              }}
            >
              Retry
            </button>
          )}
        </>
      ) : !data ? (
        'Checking upcoming demand...'
      ) : data.alerts.length ? (
        <span>
          Low demand detected on{' '}
          {data.alerts
            .slice(0, 3)
            .map(day => day.date)
            .join(' & ')}{' '}
          &mdash;{' '}
          <a href={'/promotions?lowDemandDate=' + data.alerts[0].date}>
            consider creating a promotion to boost bookings.
          </a>
        </span>
      ) : data.unavailableDates.length ? (
        'Some occupancy dates cannot be assessed until room availability is complete.'
      ) : (
        'No low-demand dates detected for the available inventory.'
      )}
    </div>
  );
}
