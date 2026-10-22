'use client';
import { useEffect, useState } from 'react';
import { AnalyticsError } from '@/lib/analytics';
import { loadLowDemand, type LowDemand } from '@/lib/low-demand';

export default function LowDemandAlerts() {
  const [data, setData] = useState<LowDemand>();
  const [error, setError] = useState<number>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    loadLowDemand(controller.signal)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof AnalyticsError ? reason.status : 503);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);
  return (
    <section aria-labelledby="low-demand-title" className="mb-6 mt-6">
      <h2
        id="low-demand-title"
        className="font-medium text-[12px] underline text-black mb-3"
      >
        Low-demand dates
      </h2>
      {!data && !error && <p role="status">Loading low-demand alerts...</p>}
      {error && (
        <div role="alert" className="border border-gray-200 rounded-lg p-4">
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
                setAttempt((n) => n + 1);
              }}
            >
              Retry low-demand alerts
            </button>
          )}
        </div>
      )}
      {data && (
        <>
          <p className="text-[10.5px] text-black/60 mb-3">
            {data.from} to {data.to} (Asia/Colombo). Alerts are strictly below{' '}
            {data.threshold * 100}% expected occupancy, using active rooms
            excluding maintenance.
          </p>
          {!data.alerts.length && (
            <p role="status">
              No low-demand alerts for dates with available occupancy data.
            </p>
          )}
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {data.alerts.map((day) => (
              <li
                key={day.date}
                className="border border-gray-200 rounded-lg p-4"
              >
                <h3 className="font-medium text-[12px]">{day.date}</h3>
                <p className="text-[10.5px]">
                  Expected occupancy: {((day.rate ?? 0) * 100).toFixed(1)}% (
                  {day.occupiedRooms}/{day.eligibleRooms} rooms)
                </p>
                <a
                  className="font-medium text-[10.5px] underline"
                  href={'/promotions?lowDemandDate=' + day.date}
                >
                  Create Promotion
                  <span className="sr-only"> for {day.date}</span>
                </a>
              </li>
            ))}
          </ul>
          {data.unavailableDates.length > 0 && (
            <p role="status" className="text-[10.5px] mt-3">
              Occupancy unavailable (no eligible rooms):{' '}
              {data.unavailableDates.map((day) => day.date).join(', ')}. These
              dates cannot be assessed as healthy demand.
            </p>
          )}
          <p className="text-[10px] text-black/60 mt-3">
            Reporting timestamp: {data.freshness.queriedAt}
          </p>
        </>
      )}
    </section>
  );
}
