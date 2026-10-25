'use client';
import { useState } from 'react';
import { type Period } from '@/lib/analytics';
import { foodSchema, serviceSchema, localBoundary } from '@/lib/operations-analytics';
import { useAnalyticsSnapshot } from './useAnalyticsSnapshot';
import { AnalyticsClock, PeriodButtons, AnalyticsFailure, MetricCard, DataTable } from './AnalyticsControls';
import ReportDownload from './ReportDownload';
import KitchenQueue from './KitchenQueue';
export default function OperationsAnalytics({ type }: { type: 'food-orders' | 'service-requests' }) {
  const [period, setPeriod] = useState<Period>('week');
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
    <main className="flex-1 min-w-0 px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[15px] text-black">{title}</h1>
        <div className="flex items-center gap-4">
          <PeriodButtons period={period} onChange={setPeriod} />
          <AnalyticsClock />
        </div>
      </div>
      {!data ? (
        <AnalyticsFailure error={state.error} retry={state.retry} />
      ) : (
        <>
          <p className="text-[10.5px] text-black/60 mb-3">
            {localBoundary(data.start)} to {localBoundary(data.end)} (exclusive end). Asia/Colombo.
          </p>
          <section className="mb-6">
            <h2 className="font-medium text-[12px] underline text-black mb-3">{title} analytics</h2>
            <div className="grid grid-cols-4 gap-4">
              <MetricCard
                label={type === 'food-orders' ? 'Orders placed' : 'Requests submitted'}
                value={String(data.total)}
              />
              {type === 'food-orders' && food.data ? (
                <>
                  <MetricCard
                    label="Peak hours"
                    value={
                      food.data.peakHours.length
                        ? food.data.peakHours.map(h => String(h).padStart(2, '0') + ':00').join(', ')
                        : 'N/A'
                    }
                    note="Hotel-local placement hour"
                  />
                  <MetricCard label="Most popular item" value={food.data.popularItems[0]?.name ?? 'N/A'} />
                  <MetricCard
                    label="Popular items listed"
                    value={String(food.data.popularItems.length)}
                    note="Top 10 by ordered quantity"
                  />
                </>
              ) : service.data ? (
                <>
                  <MetricCard label="Completed requests" value={String(service.data.resolution.completedCount)} />
                  <MetricCard
                    label="Average resolution time"
                    value={
                      service.data.resolution.averageMinutes === null
                        ? 'N/A'
                        : service.data.resolution.averageMinutes + ' min'
                    }
                    note="Valid completion durations"
                  />
                  <MetricCard
                    label="Unresolved backlog"
                    value={String(service.data.backlog.count)}
                    note="Current unresolved requests across all dates"
                  />
                </>
              ) : null}
            </div>
            <ReportDownload type={type} filters={{ period }} />
            {data.total === 0 && (
              <p role="status" className="text-[10.5px] mt-3">
                No orders/requests created for this period.
              </p>
            )}
          </section>
        </>
      )}
      <div className="grid grid-cols-3 gap-4 mb-10">
        {type === 'food-orders' && <KitchenQueue />}
        {type === 'food-orders' && food.data ? (
          <>
            <section className="border border-gray-200 rounded-lg p-4">
              <DataTable
                caption="Top ordered items"
                headings={['Item', 'Quantity']}
                rows={food.data.popularItems.map(i => [i.name, i.quantity])}
              />
            </section>
            <section className="col-span-3 border border-gray-200 rounded-lg p-4">
              <DataTable
                caption="Orders by placement hour (Asia/Colombo)"
                headings={['Local hour', 'Orders']}
                rows={food.data.hours.map(h => [String(h.hour).padStart(2, '0') + ':00', h.count])}
              />
            </section>
          </>
        ) : service.data ? (
          <>
            <section className="col-span-3 border border-gray-200 rounded-lg p-4">
              <DataTable
                caption="Requests created by current status"
                headings={['Status', 'Requests']}
                rows={service.data.byStatus.map(s => [s.status.replaceAll('_', ' '), s.count])}
              />
              <p className="text-[10px] mt-3">
                Average excludes {service.data.resolution.excludedCount} completed requests with invalid durations. Data
                quality: {service.data.dataQuality.status}. Resolution uses completions in the period; backlog includes
                all current unresolved dates.
              </p>
            </section>
          </>
        ) : null}
        {data && (
          <section className="col-span-3 border border-gray-200 rounded-lg p-4">
            <DataTable
              caption="Daily demand"
              headings={['Hotel date', 'Created count']}
              rows={data.trend.map(d => [d.date, d.count])}
            />
          </section>
        )}
      </div>
      {data && (
        <p className="text-[10px] text-black/60">
          Retrieved: {data.freshness.queriedAt}; source update: {data.freshness.sourceLatestUpdatedAt ?? 'Unavailable'}.
        </p>
      )}
    </main>
  );
}
