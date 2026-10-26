'use client';
import ReportDownload from './ReportDownload';
import { PageHeader, SummaryCard, DataPanel, UnavailableRow } from './DashboardVisuals';
import LowDemandAlerts from './LowDemandAlerts';
import { DataTable } from './AnalyticsControls';
import { useEffect, useState, type ReactNode } from 'react';
import { AnalyticsError, loadAnalytics, money, percentage, type Overview, type Period } from '@/lib/analytics';

type State = { period: Period; data?: Overview; error?: number };
const button = 'font-medium text-xs text-ink px-3 py-1 rounded focus-visible:outline-2 focus-visible:outline-offset-2';
const localDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    dateStyle: 'medium'
  }).format(new Date(value));
export default function AnalyticsDashboard({ children }: { children?: ReactNode }) {
  const [period, setPeriod] = useState<Period>('week');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ period: 'week' });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    loadAnalytics(period, controller.signal)
      .then(data => {
        if (active) setState({ period, data });
      })
      .catch(error => {
        if (active)
          setState({
            period,
            error: error instanceof AnalyticsError ? error.status : 503
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [period, attempt]);
  const data = state.period === period ? state.data : undefined;
  const error = state.period === period ? state.error : undefined;
  const choose = (next: Period) => {
    if (next !== period) {
      setState({ period: next });
      setPeriod(next);
    }
  };
  const retry = () => {
    setState({ period });
    setAttempt(value => value + 1);
  };
  return (
    <main className="dashboard-page">
      <PageHeader title="Analytics" period={period} onPeriodChange={choose} />
      <p className="section-eyebrow">Booking &amp; revenue</p>
      <div className="summary-grid">
        <SummaryCard label={`Total bookings (${period})`} value={data ? String(data.bookings.total) : '\u2014'} />
        <SummaryCard
          label={`Revenue (${period})`}
          value={data ? money(data.revenue.currentMinor) : '\u2014'}
          note={data ? `${percentage(data.revenue.percentageChange)} vs last ${period}` : undefined}
        />
        <SummaryCard label="Occupancy rate" value={'\u2014'} note="Period summary unavailable" />
        <SummaryCard label="Avg length of stay" value={'\u2014'} note="Summary unavailable" />
      </div>
      {error && (
        <div role="alert" className="page-note">
          Analytics could not be loaded.{' '}
          <button className="button button-secondary" onClick={retry}>
            Retry
          </button>
          {error === 401 && <a href="/login">Sign in</a>}
          {error === 403 && <a href="/change-password">Change password</a>}
        </div>
      )}
      <LowDemandAlerts compact />
      <div className="design-chart-row">
        {data ? (
          <BookingTrend data={data} />
        ) : (
          <DataPanel title="Bookings per day">
            <p className="unavailable-row">{error ? 'Booking chart unavailable.' : 'Loading booking chart...'}</p>
          </DataPanel>
        )}
        {children}
      </div>
      <DataPanel
        title="Recent bookings"
        actions={<ReportDownload type="bookings" filters={{ period }} formats={['pdf']} />}
      >
        <div className="overflow-x-auto">
          <table className="dashboard-table">
            <thead>
              <tr>
                {['Booking ID', 'Guest', 'Room type', 'Check-in', 'Check-out', 'Amount (LKR)', 'Source', 'Status'].map(
                  label => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              <UnavailableRow
                columns={8}
                message="Recent booking details are not provided by the current reporting API."
              />
            </tbody>
          </table>
        </div>
      </DataPanel>
      {data && (
        <details className="advanced-controls">
          <summary>Reporting details and revenue export</summary>
          <p>
            Bookings are counted by check-in date. Revenue is completed payments only; refunded, pending and failed rows
            are excluded. Whole calendar periods are compared in Asia/Colombo.
          </p>
          <p>
            {localDate(data.bookings.start)} to {localDate(data.bookings.end)} (exclusive end). Reporting timestamp:{' '}
            {data.bookings.asOf}.
          </p>
          <p>Previous-period revenue: {money(data.revenue.previousMinor)}.</p>
          <DataTable
            caption={`Daily booking data - ${period}`}
            headings={['Date', 'Bookings']}
            rows={data.bookings.trend.map(row => [row.date, row.count])}
          />
          <ReportDownload type="revenue" filters={{ period }} />
        </details>
      )}
    </main>
  );
}
function BookingTrend({ data }: { data: Overview }) {
  const [view, setView] = useState<'bar' | 'line'>('bar');
  const trend = data.bookings.trend;
  const max = Math.max(1, ...trend.map(row => row.count));
  const slot = 640 / Math.max(1, trend.length);
  const x = (index: number) => 10 + (index + 0.5) * slot;
  const y = (count: number) => 170 - (count / max) * 140;
  return (
    <DataPanel
      title="Bookings per day"
      actions={
        <>
          <ReportDownload type="bookings" filters={{ period: data.bookings.period }} formats={['csv']} />
          <details className="chart-options">
            <summary aria-label="Chart display options">&middot;&middot;&middot;</summary>
            <div>
              {(['bar', 'line'] as const).map(value => (
                <button
                  type="button"
                  className={button}
                  key={value}
                  aria-pressed={view === value}
                  onClick={() => setView(value)}
                >
                  {value === 'bar' ? 'Bar chart' : 'Line chart'}
                </button>
              ))}
            </div>
          </details>
        </>
      }
    >
      {view === 'bar' ? (
        <div
          className="booking-bars"
          role="img"
          aria-label="Bar chart of daily bookings"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, trend.length)}, minmax(0, 1fr))` }}
        >
          {trend.map(row => (
            <div className="booking-bar-column" key={row.date} title={`${row.date}: ${row.count} bookings`}>
              <div className="booking-bar-track">
                <span
                  style={{
                    height: `${(row.count / max) * 100}%`,
                    background: row.count < max * 0.5 ? '#c7daee' : 'var(--color-brand)'
                  }}
                />
              </div>
              <span className="booking-bar-day">
                {data.bookings.period === 'week'
                  ? new Date(row.date).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
                  : row.date.slice(8)}
              </span>
              <span>{row.count}</span>
            </div>
          ))}
        </div>
      ) : (
        <svg
          role="img"
          aria-labelledby="chart-title"
          aria-describedby="chart-description"
          viewBox="0 0 660 220"
          className="booking-chart"
        >
          <title id="chart-title">Line chart of daily bookings</title>
          <desc id="chart-description">
            Daily counts for the selected {data.bookings.period}; exact values are displayed below each bar.
          </desc>
          <polyline
            points={trend.map((row, index) => `${x(index)},${y(row.count)}`).join(' ')}
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth="2"
          />
          {trend.map((row, index) => (
            <g key={row.date}>
              <circle cx={x(index)} cy={y(row.count)} r="3" fill="var(--color-brand)" />
              <text x={x(index)} y="190" textAnchor="middle" fontSize="10">
                {data.bookings.period === 'week'
                  ? new Date(row.date).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
                  : row.date.slice(8)}
              </text>
              <text x={x(index)} y="208" textAnchor="middle" fontSize="10">
                {row.count}
              </text>
            </g>
          ))}
        </svg>
      )}
      {data.bookings.total === 0 && (
        <p role="status" className="sr-only">
          No eligible bookings for this period.
        </p>
      )}
    </DataPanel>
  );
}
