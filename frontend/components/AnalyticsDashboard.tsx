'use client';
import ReportDownload from './ReportDownload';
import { PageHeader, SummaryCard, DataPanel, UnavailableRow } from './DashboardVisuals';
import LowDemandAlerts from './LowDemandAlerts';
import OccupancyCalendar from './OccupancyCalendar';
import { statusColor } from '@/lib/status-color';
import { hotelMonth } from '@/lib/occupancy';
import { useEffect, useState } from 'react';
import { AnalyticsError, loadAnalytics, money, percentage, type Overview, type Period } from '@/lib/analytics';
const shortDate = (date: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(date));
const label = (value: string) =>
  value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
const revenueValue = (minor: number) =>
  minor >= 10000000
    ? 'LKR ' +
      new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 2 })
        .format(minor / 100)
        .replace(/[kmbt]$/i, suffix => suffix.toUpperCase())
    : money(minor);
type State = { period: Period; data?: Overview; error?: number };
export default function AnalyticsDashboard() {
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
    <main className="dashboard-page analytics-page">
      <PageHeader title="Analytics" period={period} onPeriodChange={choose} />
      <p className="section-eyebrow">Booking &amp; revenue</p>
      <div className="summary-grid analytics-summary">
        <SummaryCard label={`Total bookings (${period})`} value={data ? String(data.bookings.total) : '\u2014'} />
        <SummaryCard
          label={`Revenue (${period})`}
          title={data ? money(data.revenue.currentMinor) : undefined}
          value={data ? revenueValue(data.revenue.currentMinor) : '\u2014'}
          note={data ? `${percentage(data.revenue.percentageChange)} vs last ${period}` : undefined}
        />
        <SummaryCard
          label="Occupancy rate"
          title={
            data
              ? `Occupied room nights / eligible room nights. ${data.occupancy.roomsUsingCreationDate} rooms use creation date where no availability schedule is recorded.`
              : undefined
          }
          value={data?.occupancy.rate == null ? '\u2014' : (data.occupancy.rate * 100).toFixed(1) + '%'}
          note={data && data.occupancy.eligibleRoomNights === 0 ? 'No eligible room nights' : undefined}
        />
        <SummaryCard
          label="Avg length of stay"
          title="Average nights for confirmed, checked-in and checked-out bookings checking in during the selected period."
          value={data?.averageLengthOfStay == null ? '\u2014' : data.averageLengthOfStay.toFixed(1) + ' nights'}
          note={data && data.averageLengthOfStay === null ? 'No eligible stays in this period' : undefined}
        />
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
      <LowDemandAlerts />
      <div className="design-chart-row">
        {data ? (
          <BookingTrend data={data} />
        ) : (
          <DataPanel title="Bookings per day">
            <p className="unavailable-row">{error ? 'Booking chart unavailable.' : 'Loading booking chart...'}</p>
          </DataPanel>
        )}
        <OccupancyCalendar initialMonth={hotelMonth()} />
      </div>
      <DataPanel
        title="Recent bookings"
        actions={<ReportDownload type="bookings" filters={{ period }} formats={['pdf']} />}
      >
        <div className="overflow-x-auto">
          <table className="dashboard-table recent-bookings-table">
            <caption className="sr-only">Recent bookings for the selected {period}</caption>
            <thead>
              <tr>
                {['Booking ID', 'Guest', 'Room type', 'Check-in', 'Check-out', 'Amount (LKR)', 'Source', 'Status'].map(
                  text => (
                    <th key={text} scope="col">
                      {text}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {data?.recentBookings.map(booking => (
                <tr key={booking.id}>
                  <td title={booking.id}>
                    <span className="booking-id">{booking.id}</span>
                  </td>
                  <td>{booking.guestName ?? 'Unregistered guest'}</td>
                  <td>{booking.roomType}</td>
                  <td title={booking.checkIn}>{shortDate(booking.checkIn)}</td>
                  <td title={booking.checkOut}>{shortDate(booking.checkOut)}</td>
                  <td>{money(booking.amountMinor).replace('LKR ', '')}</td>
                  <td>{label(booking.source)}</td>
                  <td>
                    <span className={'status-badge ' + statusColor(booking.status)}>{label(booking.status)}</span>
                  </td>
                </tr>
              ))}
              {!data?.recentBookings.length && (
                <UnavailableRow
                  columns={8}
                  message={
                    error
                      ? 'Recent bookings could not be loaded.'
                      : data
                        ? 'No bookings check in during this period.'
                        : 'Loading recent bookings...'
                  }
                />
              )}
            </tbody>
          </table>
        </div>
      </DataPanel>
    </main>
  );
}
function BookingTrend({ data }: { data: Overview }) {
  const trend = data.bookings.trend;
  const max = Math.max(1, ...trend.map(row => row.count));
  const monthly = data.bookings.period === 'month';
  return (
    <DataPanel
      title="Bookings per day"
      actions={<ReportDownload type="bookings" filters={{ period: data.bookings.period }} formats={['csv']} />}
    >
      <div className="booking-chart-scroll" tabIndex={0} role="region" aria-label="Daily bookings chart">
        <div
          className={'booking-bars' + (monthly ? ' booking-bars-month' : '')}
          role="img"
          aria-label={`Bar chart of daily bookings: ${trend.map(row => row.date + ': ' + row.count).join(', ')}`}
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, trend.length)}, minmax(0,1fr))`,
            minWidth: monthly ? 360 : undefined
          }}
        >
          {trend.map((row, index) => (
            <div className="booking-bar-column" key={row.date} title={`${row.date}: ${row.count} bookings`}>
              <div className="booking-bar-track">
                <span
                  style={{
                    height: `${(row.count / max) * 100}%`,
                    background: row.count < max * 0.5 ? '#c7daee' : 'var(--color-brand)'
                  }}
                />
              </div>
              <span
                className="booking-bar-day"
                style={
                  monthly &&
                  index !== 0 &&
                  index !== trend.length - 1 &&
                  !((index + 1) % 5 === 0 && index < trend.length - 3)
                    ? { visibility: 'hidden' }
                    : undefined
                }
              >
                {monthly
                  ? String(Number(row.date.slice(8)))
                  : data.bookings.period === 'week'
                    ? new Date(row.date).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
                    : shortDate(row.date)}
              </span>
              <span className={monthly ? 'sr-only' : undefined}>{row.count}</span>
            </div>
          ))}
        </div>
      </div>
      {data.bookings.total === 0 && (
        <p role="status" className="sr-only">
          No eligible bookings for this period.
        </p>
      )}
    </DataPanel>
  );
}
