'use client';
import { useState } from 'react';
import { type Period } from '@/lib/analytics';
import { foodSchema, serviceSchema, localBoundary } from '@/lib/operations-analytics';
import { useAnalyticsSnapshot } from './useAnalyticsSnapshot';
import { AnalyticsFailure, DataTable } from './AnalyticsControls';
import { PageHeader, SummaryCard, DataPanel, UnavailableRow } from './DashboardVisuals';
import { type KitchenSnapshot } from '@/lib/kitchen';
import ReportDownload from './ReportDownload';
import KitchenQueue from './KitchenQueue';
export default function OperationsAnalytics({ type }: { type: 'food-orders' | 'service-requests' }) {
  const [period, setPeriod] = useState<Period>('week');
  const [kitchen, setKitchen] = useState<KitchenSnapshot | null>(null);
  const food = useAnalyticsSnapshot(
    '/api/analytics/operations/food-orders?period=' + period,
    foodSchema,
    type === 'food-orders'
  );
  const service = useAnalyticsSnapshot(
    '/api/analytics/operations/service-requests?period=' + period,
    serviceSchema,
    type === 'service-requests'
  );
  const data = type === 'food-orders' ? food.data : service.data;
  const state = type === 'food-orders' ? food : service;
  const title = type === 'food-orders' ? 'Food orders' : 'Service requests';
  return (
    <main className="dashboard-page">
      <PageHeader title={title} period={period} onPeriodChange={setPeriod} />
      <p className="section-eyebrow">{type === 'food-orders' ? 'Food order analytics' : 'Service request analytics'}</p>
      <div className="summary-grid">
        <SummaryCard
          label={(type === 'food-orders' ? 'Orders' : 'Requests') + (period === 'day' ? ' today' : ' this ' + period)}
          value={data ? String(data.total) : '\u2014'}
        />
        {type === 'food-orders' ? (
          <>
            <SummaryCard
              label="Pending in kitchen"
              value={
                kitchen
                  ? String(kitchen.counts.PLACED + kitchen.counts.IN_PREPARATION + kitchen.counts.READY)
                  : '\u2014'
              }
            />
            <SummaryCard label="Avg delivery time" value={'\u2014'} note="Not provided by the analytics API" />
            <SummaryCard label="Revenue (food)" value={'\u2014'} note="Not provided by the analytics API" />
          </>
        ) : (
          <>
            <SummaryCard
              label="Resolved"
              value={service.data ? String(service.data.resolution.completedCount) : '\u2014'}
              tone="success"
            />
            <SummaryCard
              label="Unresolved"
              value={service.data ? String(service.data.backlog.count) : '\u2014'}
              tone="danger"
            />
            <SummaryCard
              label="Avg resolution"
              value={
                service.data?.resolution.averageMinutes == null
                  ? '\u2014'
                  : service.data.resolution.averageMinutes + ' min'
              }
            />
          </>
        )}
      </div>
      {!data && <AnalyticsFailure error={state.error} retry={state.retry} />}
      {type === 'food-orders' ? (
        <div className="operations-panels">
          <KitchenQueue onSnapshot={setKitchen} />
          <DataPanel title={`Top ordered items (${period})`}>
            <div className="overflow-x-auto">
              <table className="dashboard-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {food.data?.popularItems.map(item => (
                    <tr key={item.menuItemId + item.name}>
                      <td>{item.name}</td>
                      <td className="muted-dash" title="Category is not provided by this API">
                        &mdash;
                      </td>
                      <td title="Ordered quantity">{item.quantity}</td>
                    </tr>
                  ))}
                  {!food.data?.popularItems.length && (
                    <UnavailableRow
                      columns={3}
                      message={food.data ? 'No items ordered in this period.' : 'Top items unavailable.'}
                    />
                  )}
                </tbody>
              </table>
            </div>
          </DataPanel>
        </div>
      ) : (
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
      )}
      {data && (
        <details className="advanced-controls">
          <summary>Detailed analytics and exports</summary>
          <p className="page-note">
            {localBoundary(data.start)} to {localBoundary(data.end)} (exclusive end). Asia/Colombo.
          </p>
          <ReportDownload type={type} filters={{ period }} />
          {type === 'food-orders' && food.data ? (
            <DataTable
              caption="Orders by placement hour"
              headings={['Hour', 'Orders']}
              rows={food.data.hours.map(h => [String(h.hour).padStart(2, '0') + ':00', h.count])}
            />
          ) : service.data ? (
            <>
              <DataTable
                caption="Requests by current status"
                headings={['Status', 'Requests']}
                rows={service.data.byStatus.map(row => [row.status.replaceAll('_', ' '), row.count])}
              />
              <p className="page-note">
                Duration quality: {service.data.dataQuality.status}; {service.data.resolution.excludedCount} invalid
                durations excluded. Backlog includes open requests across all dates.
              </p>
            </>
          ) : null}
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
