'use client';
import { useState } from 'react';
import { type Period, compactMoney, money } from '@/lib/analytics';
import { hotelDate } from '@/lib/analytics-period';
import { foodSchema } from '@/lib/operations-analytics';
import { type KitchenSnapshot } from '@/lib/kitchen';
import { useAnalyticsSnapshot } from './useAnalyticsSnapshot';
import { AnalyticsFailure } from './AnalyticsControls';
import { PageHeader, SummaryCard, DataPanel, UnavailableRow } from './DashboardVisuals';
import AnalyticsPeriodNavigation from './AnalyticsPeriodNavigation';
import KitchenQueue from './KitchenQueue';
export default function FoodAnalytics() {
  const [period, setPeriod] = useState<Period>('week');
  const [date, setDate] = useState(() => hotelDate());
  const [kitchen, setKitchen] = useState<KitchenSnapshot | null>(null);
  const { data, error, retry } = useAnalyticsSnapshot(
    '/api/analytics/operations/food-orders?' + new URLSearchParams({ period, date }),
    foodSchema
  );
  const range = data
    ? { from: hotelDate(new Date(data.start)), to: hotelDate(new Date(Date.parse(data.end) - 86400000)) }
    : undefined;
  return (
    <main className="dashboard-page food-analytics-page">
      <PageHeader title="Food orders" period={period} onPeriodChange={setPeriod} />
      <AnalyticsPeriodNavigation period={period} date={date} onChange={setDate} range={range} scope="food analytics" />
      <p className="section-eyebrow">Food order analytics</p>
      <div className="summary-grid analytics-summary">
        <SummaryCard
          label="Pending in kitchen"
          value={
            kitchen ? String(kitchen.counts.PLACED + kitchen.counts.IN_PREPARATION + kitchen.counts.READY) : '\u2014'
          }
          title="Live active orders across all dates, independent of the selected reporting period."
        />
        <SummaryCard
          label={'Orders (' + period + ')'}
          value={data ? String(data.total) : '\u2014'}
          title="Non-cancelled orders placed during the selected period."
        />
        <SummaryCard
          label="Avg delivery time"
          value={
            data?.delivery.averageMinutes == null
              ? '\u2014'
              : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(data.delivery.averageMinutes) +
                ' min'
          }
          note={
            data && data.delivery.deliveredCount === 0
              ? 'No deliveries in this period'
              : data?.delivery.excludedDurationCount
                ? data.delivery.excludedDurationCount + ' invalid durations excluded'
                : undefined
          }
          title="Placement to delivery for orders delivered in the selected period. Invalid durations are excluded."
        />
        <SummaryCard
          label="Revenue (food)"
          value={data ? compactMoney(data.revenue.amountMinor) : '\u2014'}
          title={
            data
              ? money(data.revenue.amountMinor) +
                ' delivered-order sales by delivery date; not confirmed cash receipts.'
              : undefined
          }
        />
      </div>
      {!data && <AnalyticsFailure error={error} retry={retry} />}
      <div className="operations-panels">
        <KitchenQueue onSnapshot={setKitchen} />
        <DataPanel title={'Top ordered items (' + period + ')'}>
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
                {data?.popularItems.map(item => (
                  <tr key={item.menuItemId + item.name}>
                    <td>{item.name}</td>
                    <td className="muted-dash" title="Category is not supplied by this reporting source">
                      &mdash;
                    </td>
                    <td title="Ordered quantity">{item.quantity}</td>
                  </tr>
                ))}
                {!data?.popularItems.length && (
                  <UnavailableRow
                    columns={3}
                    message={data ? 'No items ordered in this period.' : 'Top items unavailable.'}
                  />
                )}
              </tbody>
            </table>
          </div>
        </DataPanel>
      </div>
    </main>
  );
}
