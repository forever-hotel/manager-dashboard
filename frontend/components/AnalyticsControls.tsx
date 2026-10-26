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
export function DataTable({
  caption,
  headings,
  rows
}: {
  caption: string;
  headings: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full text-left border-collapse dashboard-table">
        <caption className="font-medium text-[13px] text-ink mb-3 text-left">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            {headings.map(h => (
              <th scope="col" key={h} className="font-medium text-xs text-ink py-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border">
              {row.map((v, j) => (
                <td key={j} className="text-xs text-ink py-2">
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="text-xs text-muted">No records for this period.</p>}
    </div>
  );
}
