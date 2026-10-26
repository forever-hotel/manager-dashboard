'use client';
import { useState } from 'react';
import type { Period } from '@/lib/analytics';
import { serviceSchema, localBoundary } from '@/lib/operations-analytics';
import { useAnalyticsSnapshot } from './useAnalyticsSnapshot';
import { AnalyticsFailure, DataTable } from './AnalyticsControls';
import { PageHeader, SummaryCard, DataPanel, UnavailableRow } from './DashboardVisuals';
import ReportDownload from './ReportDownload';
import FoodAnalytics from './FoodAnalytics';
export default function OperationsAnalytics({ type }: { type: 'food-orders' | 'service-requests' }) {
  return type === 'food-orders' ? <FoodAnalytics /> : <ServiceAnalytics />;
}
function ServiceAnalytics() {
  const [period, setPeriod] = useState<Period>('week');
  const { data, error, retry } = useAnalyticsSnapshot(
    '/api/analytics/operations/service-requests?period=' + period,
    serviceSchema
  );
  return (
    <main className="dashboard-page">
      <PageHeader title="Service requests" period={period} onPeriodChange={setPeriod} />
      <p className="section-eyebrow">Service request analytics</p>
      <div className="summary-grid">
        <SummaryCard
          label={'Requests' + (period === 'day' ? ' today' : ' this ' + period)}
          value={data ? String(data.total) : '\u2014'}
        />
        <SummaryCard label="Resolved" value={data ? String(data.resolution.completedCount) : '\u2014'} tone="success" />
        <SummaryCard label="Unresolved" value={data ? String(data.backlog.count) : '\u2014'} tone="danger" />
        <SummaryCard
          label="Avg resolution"
          value={data?.resolution.averageMinutes == null ? '\u2014' : data.resolution.averageMinutes + ' min'}
        />
      </div>
      {!data && <AnalyticsFailure error={error} retry={retry} />}
      <DataPanel title="Active service requests">
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
              <UnavailableRow
                columns={6}
                message="Individual service requests and assignees are not provided by the current analytics API."
              />
            </tbody>
          </table>
        </div>
      </DataPanel>
      {data && (
        <details className="advanced-controls">
          <summary>Detailed analytics and exports</summary>
          <p className="page-note">
            {localBoundary(data.start)} to {localBoundary(data.end)} (exclusive end). Asia/Colombo.
          </p>
          <ReportDownload type="service-requests" filters={{ period }} />
          <DataTable
            caption="Requests by current status"
            headings={['Status', 'Requests']}
            rows={data.byStatus.map(row => [row.status.replaceAll('_', ' '), row.count])}
          />
          <p className="page-note">
            Duration quality: {data.dataQuality.status}; {data.resolution.excludedCount} invalid durations excluded.
            Backlog includes open requests across all dates.
          </p>
          <DataTable
            caption="Daily demand"
            headings={['Hotel date', 'Created count']}
            rows={data.trend.map(day => [day.date, day.count])}
          />
        </details>
      )}
    </main>
  );
}
