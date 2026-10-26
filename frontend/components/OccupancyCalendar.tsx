'use client';
import ReportDownload from './ReportDownload';
import { DataPanel } from './DashboardVisuals';
import { useEffect, useState } from 'react';
import { AnalyticsError } from '@/lib/analytics';
import { demand, leadingDays, loadOccupancy, shiftMonth, type Occupancy, type OccupancyDay } from '@/lib/occupancy';

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
    <DataPanel
      title={
        'Occupancy heatmap \u2014 ' +
        new Date(month + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
      }
      actions={
        <details className="heatmap-options">
          <summary>Legend</summary>
          <div className="heatmap-popover">
            <p>Low: below 40%; Medium: 40–69%; High: 70–100%. Unknown inventory is not zero occupancy.</p>
            {!!data?.roomsUsingCreationDate && (
              <p>
                {data.roomsUsingCreationDate} rooms use their creation date because no availability schedule is
                recorded.
              </p>
            )}
            <button
              type="button"
              aria-label="Previous occupancy month"
              disabled={!previous}
              onClick={() => navigate(previous)}
            >
              Previous month
            </button>
            <button type="button" aria-label="Next occupancy month" disabled={!next} onClick={() => navigate(next)}>
              Next month
            </button>
            <ReportDownload type="occupancy" filters={{ from: month + '-01', to: data?.to ?? month + '-01' }} />
          </div>
        </details>
      }
    >
      <div className="compact-heatmap" role="group" aria-label={`Occupancy calendar ${month}`}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
          <span key={index} className="heatmap-weekday">
            {day}
          </span>
        ))}
        {Array.from({ length: leadingDays(month) }, (_, index) => (
          <span key={'blank-' + index} />
        ))}
        {data?.dates.map(day => (
          <button
            type="button"
            key={day.date}
            aria-label={describe(day)}
            aria-pressed={selected === day.date}
            title={describe(day)}
            onFocus={() => setSelected(day.date)}
            onClick={() => setSelected(day.date)}
            className={'heatmap-cell heatmap-' + demand(day.rate).toLowerCase()}
          />
        ))}
      </div>
      {!data && (
        <p className="page-note px-5" role={error ? 'alert' : 'status'}>
          {error === 401
            ? 'Your session ended.'
            : error === 403
              ? 'You do not have permission to view occupancy.'
              : error
                ? 'Occupancy unavailable.'
                : 'Loading occupancy...'}{' '}
          {error === 401 && <a href="/login">Sign in</a>}
          {error && error !== 401 && error !== 403 && (
            <button
              type="button"
              aria-label="Retry occupancy"
              onClick={() => {
                setAttempt(n => n + 1);
              }}
            >
              Retry
            </button>
          )}
        </p>
      )}
      {data?.dates.length === 0 && <p className="page-note px-5">No occupancy data is available for this month.</p>}
      <div className="compact-legend">
        <span>
          <i className="heatmap-low" />
          Low
        </span>
        <span>
          <i className="heatmap-high" />
          High
        </span>
        <span>
          <i className="heatmap-alert" />
          Alert
        </span>
      </div>
      <span className="sr-only" aria-live="polite">
        {inspected ? describe(inspected) : 'Select a day to inspect occupancy.'}
      </span>
    </DataPanel>
  );
}
