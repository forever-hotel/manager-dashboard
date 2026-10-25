'use client';
import ReportDownload from './ReportDownload';
import { useEffect, useState } from 'react';
import { AnalyticsError } from '@/lib/analytics';
import { demand, leadingDays, loadOccupancy, shiftMonth, type Occupancy, type OccupancyDay } from '@/lib/occupancy';

const button = 'font-medium text-xs text-ink px-3 py-1 rounded focus-visible:outline-2 focus-visible:outline-offset-2';
const colors = {
  Low: { backgroundColor: 'var(--color-brand-light)', color: 'var(--color-brand)' },
  Medium: { backgroundColor: 'var(--color-surface-alt)', color: 'var(--color-muted)' },
  High: { backgroundColor: 'var(--color-warning-light)', color: 'var(--color-warning)' },
  Unknown: { backgroundColor: 'var(--color-surface-alt)', color: 'var(--color-muted)' }
};
function describe(day: OccupancyDay) {
  return `${day.date}: ${day.occupiedRooms} occupied rooms, ${day.eligibleRooms} eligible rooms; ${day.rate === null ? 'occupancy unknown (no eligible capacity)' : `${(day.rate * 100).toFixed(1)}% occupancy`}; ${demand(day.rate)} demand.`;
}
type State = { month: string; data?: Occupancy; error?: number };

export default function OccupancyCalendar({ initialMonth }: { initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ month: initialMonth });
  const [selected, setSelected] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    loadOccupancy(month, controller.signal)
      .then(data => {
        if (active) setState({ month, data });
      })
      .catch(error => {
        if (active)
          setState({
            month,
            error: error instanceof AnalyticsError ? error.status : 503
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [month, attempt]);
  const data = state.month === month ? state.data : undefined;
  const error = state.month === month ? state.error : undefined;
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const navigate = (value: string | null) => {
    if (value) {
      setSelected(undefined);
      setState({ month: value });
      setMonth(value);
    }
  };
  const inspected = data?.dates.find(day => day.date === selected);
  return (
    <section aria-labelledby="occupancy-heading" className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 id="occupancy-heading" className="font-medium text-base text-ink">
          Occupancy demand calendar
        </h2>
        <div className="flex items-center gap-4" role="group" aria-label="Occupancy month">
          <button
            type="button"
            className={button + ' button button-secondary'}
            aria-label="Previous occupancy month"
            disabled={!previous}
            onClick={() => navigate(previous)}
          >
            Previous
          </button>
          <span className="font-medium text-xs text-ink" aria-live="polite">
            {month}
          </span>
          <button
            type="button"
            className={button + ' button button-secondary'}
            aria-label="Next occupancy month"
            disabled={!next}
            onClick={() => navigate(next)}
          >
            Next
          </button>
        </div>
      </div>
      {data && <ReportDownload type="occupancy" filters={{ from: data.from, to: data.to }} />}
      <div className="border border-border rounded-lg p-5 space-y-5 bg-surface">
        <p className="font-normal text-xs text-muted">
          Asia/Colombo dates. Capacity means active rooms excluding maintenance. Display bands are separate from
          low-booking alerts.
        </p>
        <div role="group" aria-label="Demand scale legend" className="flex flex-wrap items-center gap-4">
          {(['Low', 'Medium', 'High', 'Unknown'] as const).map(level => (
            <span key={level} className="font-normal text-xs rounded px-3 py-1" style={colors[level]}>
              {level}:{' '}
              {level === 'Low'
                ? 'below 40%'
                : level === 'Medium'
                  ? '40% to below 70%'
                  : level === 'High'
                    ? '70% to 100%'
                    : 'no eligible capacity'}
            </span>
          ))}
        </div>
        {!data && !error && (
          <p role="status" className="font-normal text-xs text-ink">
            Loading occupancy...
          </p>
        )}
        {error && (
          <div role="alert" className="font-normal text-xs text-ink">
            <p>
              {error === 401
                ? 'Your session has expired. Sign in to view occupancy.'
                : error === 403
                  ? 'You do not have permission to view occupancy.'
                  : 'Occupancy is unavailable. Please retry.'}
            </p>
            {error === 401 ? (
              <a href="/login?next=%2Fanalytics" className={button}>
                Sign in
              </a>
            ) : (
              error !== 403 && (
                <button
                  type="button"
                  className={button + ' button button-secondary'}
                  onClick={() => {
                    setState({ month });
                    setAttempt(value => value + 1);
                  }}
                >
                  Retry occupancy
                </button>
              )
            )}
          </div>
        )}
        {data && data.dates.length === 0 && (
          <p role="status" className="font-normal text-xs text-ink">
            No occupancy data is available for this month.
          </p>
        )}
        {data && data.dates.length > 0 && (
          <>
            {data.dates.every(day => day.rate === null) ? (
              <p role="status" className="font-normal text-xs text-ink">
                Occupancy is unknown: no eligible room capacity is available this month.
              </p>
            ) : (
              data.dates.every(day => day.occupiedRooms === 0 && day.rate !== null) && (
                <p role="status" className="font-normal text-xs text-ink">
                  No occupied rooms this month. Known occupancy is 0%.
                </p>
              )
            )}
            <div className="grid grid-cols-7 gap-3" role="group" aria-label={`Occupancy calendar ${month}`}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                <span key={day} className="font-normal text-xs text-ink text-center">
                  {day}
                </span>
              ))}
              {Array.from({ length: leadingDays(month) }, (_, index) => (
                <span key={`blank-${index}`} aria-hidden="true" />
              ))}
              {data.dates.map(day => (
                <button
                  key={day.date}
                  type="button"
                  className="rounded p-2 text-center font-medium text-xs leading-tight focus-visible:outline-2 focus-visible:outline-offset-2 button button-secondary calendar-day"
                  style={colors[demand(day.rate)]}
                  aria-label={describe(day)}
                  aria-pressed={selected === day.date}
                  onFocus={() => setSelected(day.date)}
                  onClick={() => setSelected(day.date)}
                >
                  <span>{Number(day.date.slice(-2))}</span>
                  <br />
                  <span>{day.rate === null ? 'N/A' : `${(day.rate * 100).toFixed(1)}%`}</span>
                  <br />
                  <span>{demand(day.rate)}</span>
                </button>
              ))}
            </div>
            <p aria-live="polite" className="font-normal text-xs text-ink">
              {inspected ? describe(inspected) : 'Focus or select a date to inspect its room counts and occupancy.'}
            </p>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Daily occupancy data">
              <table className="w-full text-left text-xs text-ink">
                <caption className="text-left font-medium mb-3">Daily occupancy data for {month}</caption>
                <thead className="bg-surface-alt">
                  <tr>
                    {['Date', 'Occupied rooms', 'Eligible capacity', 'Occupancy', 'Demand'].map(label => (
                      <th key={label} scope="col" className="px-4 py-3">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.dates.map(day => (
                    <tr key={day.date} className="border-b border-border">
                      <th scope="row" className="px-4 py-3 font-normal">
                        {day.date}
                      </th>
                      <td className="px-4 py-3">{day.occupiedRooms}</td>
                      <td className="px-4 py-3">{day.eligibleRooms}</td>
                      <td className="px-4 py-3">
                        {day.rate === null ? 'Unknown (no eligible capacity)' : `${(day.rate * 100).toFixed(1)}%`}
                      </td>
                      <td className="px-4 py-3">{demand(day.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="font-normal text-xs text-muted">
              Retrieved: {data.freshness.queriedAt}. Latest source update:{' '}
              {data.freshness.sourceLatestUpdatedAt ?? 'Unavailable'}.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
