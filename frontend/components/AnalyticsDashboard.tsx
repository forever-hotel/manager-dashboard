'use client';
import { useEffect, useState, type ReactNode } from 'react';
import {
  AnalyticsError,
  loadAnalytics,
  money,
  percentage,
  type Overview,
  type Period,
} from '@/lib/analytics';

type State = { period: Period; data?: Overview; error?: number };
const button =
  'font-medium text-[10.5px] text-black px-3 py-1 rounded focus-visible:outline-2 focus-visible:outline-offset-2';
const localDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    dateStyle: 'medium',
  }).format(new Date(value));
export default function AnalyticsDashboard({
  children,
}: {
  children?: ReactNode;
}) {
  const [period, setPeriod] = useState<Period>('week');
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<State>({ period: 'week' });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    loadAnalytics(period, controller.signal)
      .then((data) => {
        if (active) setState({ period, data });
      })
      .catch((error) => {
        if (active)
          setState({
            period,
            error: error instanceof AnalyticsError ? error.status : 503,
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
    setAttempt((value) => value + 1);
  };
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[15px] text-black">Analytics</h1>
        <div
          role="group"
          aria-label="Reporting period"
          className="flex gap-1 bg-gray-100 rounded-md p-1"
        >
          {(['day', 'week', 'month'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={period === value}
              className={
                button + (period === value ? ' bg-white shadow-sm' : '')
              }
              onClick={() => choose(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {!data && !error && <p role="status">Loading {period} analytics?</p>}
      {error && (
        <div role="alert" className="border border-gray-200 rounded-lg p-4">
          <p>
            {error === 401
              ? 'Your session ended. Please sign in again.'
              : error === 403
                ? 'Analytics access is unavailable. Check your account or change your initial password.'
                : 'Analytics could not be loaded. Please retry.'}
          </p>
          {error === 401 ? (
            <a href="/login" className={button}>
              Sign in
            </a>
          ) : (
            <button type="button" className={button} onClick={retry}>
              Retry
            </button>
          )}
          {error === 403 && (
            <a href="/change-password" className={button}>
              Change password
            </a>
          )}
        </div>
      )}
      {data && (
        <>
          <p className="text-[10.5px] text-black/60 mb-3">
            {localDate(data.bookings.start)} ?{' '}
            {localDate(
              new Date(Date.parse(data.bookings.end) - 1).toISOString(),
            )}{' '}
            ? Asia/Colombo ? Calendar {period}
          </p>
          <section className="mb-6" aria-labelledby="booking-revenue-title">
            <h2
              id="booking-revenue-title"
              className="font-medium text-[12px] underline text-black mb-3"
            >
              Booking &amp; revenue
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card
                title={`Total bookings (${period})`}
                value={String(data.bookings.total)}
                note="By check-in date"
              />
              <Card
                title={`Completed-payment revenue (${period})`}
                value={money(data.revenue.currentMinor)}
                note={`${percentage(data.revenue.percentageChange)} vs previous ${period}`}
              />
              <Card
                title={`Previous ${period} revenue`}
                value={money(data.revenue.previousMinor)}
                note={`${localDate(data.revenue.previousStart)} ? ${localDate(new Date(Date.parse(data.revenue.previousEnd) - 1).toISOString())}`}
              />
            </div>
            <p className="text-[10.5px] text-black/60 mt-3">
              Completed payments only; refunded, pending and failed payments
              excluded. Whole calendar periods are compared; the current period
              is still in progress.
            </p>
            {data.revenue.percentageChange === null && (
              <p className="text-[10.5px] mt-2">
                Percentage comparison: N/A because previous-period revenue is
                zero.
              </p>
            )}
          </section>
          {data.bookings.total === 0 && (
            <p role="status" className="mb-3">
              No eligible bookings for this {period}.
            </p>
          )}
          <BookingTrend data={data} />
          <p className="text-[10px] text-black/60 mt-3">
            Reporting timestamp: {data.bookings.asOf}
          </p>
        </>
      )}
      {children}
    </main>
  );
}
function Card({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note: string;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <h3 className="font-normal text-[10px] text-black/60 mb-2">{title}</h3>
      <p className="font-medium text-[20px] text-black mb-1">{value}</p>
      <p className="font-normal text-[9.5px] text-black/60">{note}</p>
    </div>
  );
}
function BookingTrend({ data }: { data: Overview }) {
  const [view, setView] = useState<'bar' | 'line'>('bar');
  const trend = data.bookings.trend;
  const max = Math.max(1, ...trend.map((row) => row.count));
  const x = (index: number) =>
    30 + (trend.length === 1 ? 300 : (index * 600) / (trend.length - 1));
  const y = (count: number) => 170 - (count / max) * 140;
  return (
    <section aria-labelledby="trend-title" className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 id="trend-title" className="font-medium text-[12px]">
          Bookings per day
        </h2>
        <div role="group" aria-label="Chart view">
          {(['bar', 'line'] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={button}
              aria-pressed={view === value}
              onClick={() => setView(value)}
            >
              {value === 'bar' ? 'Bar chart' : 'Line chart'}
            </button>
          ))}
        </div>
      </div>
      <div className="border border-gray-200 rounded-lg p-5">
        <svg
          role="img"
          aria-labelledby="chart-title"
          aria-describedby="chart-description"
          viewBox="0 0 660 220"
          className="w-full max-h-64"
        >
          <title id="chart-title">
            {view === 'bar' ? 'Bar' : 'Line'} chart of daily bookings
          </title>
          <desc id="chart-description">
            Daily counts for the selected {data.bookings.period}. Exact dates
            and values are in the table below.
          </desc>
          <line x1="20" y1="170" x2="650" y2="170" stroke="#999" />
          {view === 'line' && (
            <polyline
              points={trend
                .map((row, index) => `${x(index)},${y(row.count)}`)
                .join(' ')}
              fill="none"
              stroke="#1f2937"
              strokeWidth="2"
            />
          )}
          {trend.map((row, index) => (
            <g key={row.date}>
              {view === 'bar' ? (
                <rect
                  x={x(index) - Math.min(15, 220 / trend.length)}
                  y={y(row.count)}
                  width={Math.min(30, 440 / trend.length)}
                  height={170 - y(row.count)}
                  fill="#1f2937"
                />
              ) : (
                <circle cx={x(index)} cy={y(row.count)} r="3" fill="#1f2937" />
              )}
              <text
                x={x(index)}
                y={y(row.count) - 8}
                textAnchor="middle"
                fontSize="9"
              >
                {row.count}
              </text>
              <text x={x(index)} y="190" textAnchor="middle" fontSize="9">
                {row.date.slice(8)}
              </text>
            </g>
          ))}
          <text x="330" y="212" textAnchor="middle" fontSize="10">
            Day of month (Asia/Colombo)
          </text>
        </svg>
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left border-collapse text-[10.5px]">
            <caption className="text-left font-medium mb-2">
              Daily booking data ? {data.bookings.period}
            </caption>
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th scope="col" className="px-4 py-3">
                  Check-in date
                </th>
                <th scope="col" className="px-4 py-3">
                  Bookings
                </th>
              </tr>
            </thead>
            <tbody>
              {trend.map((row) => (
                <tr key={row.date} className="border-b border-gray-100">
                  <th scope="row" className="px-4 py-3 font-normal">
                    {row.date}
                  </th>
                  <td className="px-4 py-3">{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
