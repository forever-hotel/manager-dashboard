'use client';
import { useEffect, useState } from 'react';
import { AnalyticsError } from '@/lib/analytics';
import { loadLowDemand, type LowDemand } from '@/lib/low-demand';
import ReportDownload from './ReportDownload';

export default function LowDemandAlerts() {
  const [data, setData] = useState<LowDemand>();
  const [error, setError] = useState<number>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    loadLowDemand(controller.signal)
      .then(value => {
        if (active) setData(value);
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
    <section aria-labelledby="low-demand-title" className="mb-6 mt-6">
      <h2 id="low-demand-title" className="underline mb-3 font-medium text-base text-ink">
        Low-demand dates
      </h2>
      {!data && !error && <p role="status">Loading low-demand alerts...</p>}
      {error && (
        <div role="alert" className="border border-border rounded-lg p-4 bg-surface">
          <p>
            {error === 401
              ? 'Your session ended. Sign in again.'
              : error === 403
                ? 'Low-demand alerts are not permitted for this account.'
                : 'Low-demand alerts could not be loaded. Demand is unknown.'}
          </p>
          {error === 401 ? (
            <a href="/login">Sign in</a>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(undefined);
                setData(undefined);
                setAttempt(n => n + 1);
              }}
              className="button button-secondary"
            >
              Retry low-demand alerts
            </button>
          )}
        </div>
      )}
      {data && (
        <>
          <p className="text-xs text-muted mb-3">
            {data.from} to {data.to} (Asia/Colombo). Alerts are strictly below {data.threshold * 100}% expected
            occupancy, using active rooms excluding maintenance.
          </p>
          {!data.alerts.length && <p role="status">No low-demand alerts for dates with available occupancy data.</p>}
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {data.alerts.map(day => (
              <li key={day.date} className="border border-border rounded-lg p-4 bg-surface">
                <h3 className="font-medium text-[13px]">{day.date}</h3>
                <p className="text-xs">
                  Expected occupancy: {((day.rate ?? 0) * 100).toFixed(1)}% ({day.occupiedRooms}/{day.eligibleRooms}{' '}
                  rooms)
                </p>
                <a className="button button-accent mt-3" href={'/promotions?lowDemandDate=' + day.date}>
                  Create Promotion
                  <span className="sr-only"> for {day.date}</span>
                </a>
              </li>
            ))}
          </ul>
          {data.unavailableDates.length > 0 && (
            <p role="status" className="text-xs mt-3">
              Occupancy unavailable (no eligible rooms): {data.unavailableDates.map(day => day.date).join(', ')}. These
              dates cannot be assessed as healthy demand.
            </p>
          )}
          <p className="text-xs text-muted mt-3">Reporting timestamp: {data.freshness.queriedAt}</p>
          <ReportDownload type="low-booking-alerts" filters={{}} />
        </>
      )}
    </section>
  );
}
