'use client';
import Pagination from './Pagination';
import { useState } from 'react';
import type { Period } from '@/lib/analytics';
import { hotelDate } from '@/lib/analytics-period';
import { serviceSchema, localBoundary } from '@/lib/operations-analytics';
import { serviceRequestListSchema } from '@/lib/service-requests';
import { useAnalyticsSnapshot } from './useAnalyticsSnapshot';
import { AnalyticsFailure } from './AnalyticsControls';
import { PageHeader, SummaryCard, DataPanel, UnavailableRow } from './DashboardVisuals';
import AnalyticsPeriodNavigation from './AnalyticsPeriodNavigation';
const labels = { SUBMITTED: 'Submitted', ASSIGNED: 'Assigned', IN_PROGRESS: 'In progress', COMPLETED: 'Completed' };
export default function ServiceAnalytics() {
  const [period, setPeriod] = useState<Period>('week');
  const [date, setDate] = useState(() => hotelDate());
  const [view, setView] = useState<'active' | 'all'>('all');
  const [page, setPage] = useState(1);
  const { data, error, retry } = useAnalyticsSnapshot(
    '/api/analytics/operations/service-requests?' + new URLSearchParams({ period, date }),
    serviceSchema
  );
  const list = useAnalyticsSnapshot(
    '/api/service-requests?' + new URLSearchParams({ period, date, view, page: String(page), pageSize: '20' }),
    serviceRequestListSchema
  );
  const range = data
    ? { from: hotelDate(new Date(data.start)), to: hotelDate(new Date(Date.parse(data.end) - 86400000)) }
    : undefined;
  return (
    <main className="dashboard-page service-analytics-page">
      <PageHeader
        title="Service requests"
        period={period}
        onPeriodChange={value => {
          setPeriod(value);
          setPage(1);
        }}
      />
      <AnalyticsPeriodNavigation
        period={period}
        date={date}
        onChange={value => {
          setDate(value);
          setPage(1);
        }}
        range={range}
        scope="service analytics"
      />
      <p className="section-eyebrow">Service request analytics</p>
      <div className="summary-grid">
        <SummaryCard
          label={'Requests (' + period + ')'}
          value={data ? String(data.total) : '\u2014'}
          title="Requests submitted in the selected period."
        />
        <SummaryCard
          label="Resolved"
          value={data ? String(data.resolution.completedCount) : '\u2014'}
          tone="success"
          title="Requests completed in the selected period, regardless of submission date."
        />
        <SummaryCard
          label="Unresolved"
          value={
            data
              ? String(
                  data.byStatus
                    .filter(item => item.status !== 'COMPLETED')
                    .reduce((total, item) => total + item.count, 0)
                )
              : '\u2014'
          }
          tone="danger"
          title="Unresolved requests submitted in the selected period."
        />
        <SummaryCard
          label="Avg resolution"
          value={
            data?.resolution.averageMinutes == null
              ? '\u2014'
              : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(data.resolution.averageMinutes) +
                ' min'
          }
          note={data && data.resolution.completedCount === 0 ? 'No completions in this period' : undefined}
        />
      </div>
      {!data && <AnalyticsFailure error={error} retry={retry} />}
      <div className="booking-pagination">
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setView(value => (value === 'all' ? 'active' : 'all'));
            setPage(1);
          }}
        >
          {view === 'all' ? 'Active requests' : 'All requests'}
        </button>
      </div>
      <p className="page-note">
        {view === 'active'
          ? 'Unresolved requests submitted in the selected period.'
          : 'All requests submitted in the selected period, with their current status.'}
      </p>
      <DataPanel title={view === 'active' ? 'Active service requests' : 'All service requests'}>
        {!list.data && <AnalyticsFailure error={list.error} retry={list.retry} />}
        <div className="overflow-x-auto">
          <table className="dashboard-table">
            <thead>
              <tr>
                {['Request ID', 'Room', 'Category', 'Submitted', 'Assigned to', 'Status'].map(label => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.data?.requests.map(item => (
                <tr key={item.id}>
                  <td title={item.id}>#{item.id.slice(0, 8).toUpperCase()}</td>
                  <td>{item.roomNumber}</td>
                  <td>{item.category.toLowerCase().replaceAll('_', ' ')}</td>
                  <td>{localBoundary(item.submittedAt)}</td>
                  <td>{item.assignee ?? 'Unassigned'}</td>
                  <td>
                    <span
                      className={
                        'status-badge ' +
                        (item.status === 'COMPLETED'
                          ? 'bg-success-light text-success'
                          : item.status === 'SUBMITTED'
                            ? 'bg-brand-light text-brand'
                            : 'bg-warning-light text-warning')
                      }
                    >
                      {labels[item.status]}
                    </span>
                  </td>
                </tr>
              ))}
              {list.data && !list.data.requests.length && (
                <UnavailableRow
                  columns={6}
                  message={
                    view === 'active'
                      ? 'No active service requests in this period.'
                      : 'No service requests in this period.'
                  }
                />
              )}
            </tbody>
          </table>
        </div>
        {list.data && (
          <Pagination page={page} pageSize={20} total={list.data.total} noun="requests" onChange={setPage} />
        )}
      </DataPanel>
    </main>
  );
}
