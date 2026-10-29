'use client';
import { type Period } from '@/lib/analytics';
export const analyticsButton = 'font-normal text-xs text-ink px-3 py-1 rounded';
export function PeriodButtons({ period, onChange }: { period: Period; onChange: (period: Period) => void }) {
  return (
    <div role="group" aria-label="Reporting period" className="period-switch">
      {(['day', 'week', 'month'] as const).map(p => (
        <button
          type="button"
          key={p}
          className={analyticsButton + (p === period ? ' bg-surface shadow-sm' : '') + ' button button-secondary'}
          aria-pressed={p === period}
          onClick={() => onChange(p)}
        >
          {p[0].toUpperCase() + p.slice(1)}
        </button>
      ))}
    </div>
  );
}
export function AnalyticsFailure({ error, retry }: { error?: number; retry: () => void }) {
  return error ? (
    <p role="alert" className="font-normal text-xs text-ink my-3">
      {error === 401
        ? 'Your session ended. Please sign in again.'
        : error === 403
          ? 'Manager access is required.'
          : 'Analytics unavailable.'}{' '}
      <button type="button" onClick={retry} className="underline button button-ghost">
        Retry analytics
      </button>
    </p>
  ) : (
    <p role="status" className="font-normal text-xs text-muted my-3">
      Loading analytics...
    </p>
  );
}
