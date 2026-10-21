'use client';
import { type Period } from '@/lib/analytics';
export const analyticsButton =
  'font-normal text-[10.5px] text-black px-3 py-1 rounded';
export function PeriodButtons({
  period,
  onChange,
}: {
  period: Period;
  onChange: (period: Period) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Reporting period"
      className="flex items-center gap-1 bg-gray-100 rounded-md p-1"
    >
      {(['day', 'week', 'month'] as const).map((p) => (
        <button
          type="button"
          key={p}
          className={
            analyticsButton + (p === period ? ' bg-white shadow-sm' : '')
          }
          aria-pressed={p === period}
          onClick={() => onChange(p)}
        >
          {p[0].toUpperCase() + p.slice(1)}
        </button>
      ))}
    </div>
  );
}
export function AnalyticsFailure({
  error,
  retry,
}: {
  error?: number;
  retry: () => void;
}) {
  return error ? (
    <p role="alert" className="font-normal text-[10.5px] text-black my-3">
      {error === 401
        ? 'Your session ended. Please sign in again.'
        : error === 403
          ? 'Manager access is required.'
          : 'Analytics unavailable.'}{' '}
      <button type="button" onClick={retry} className="underline">
        Retry analytics
      </button>
    </p>
  ) : (
    <p role="status" className="font-normal text-[10.5px] text-black/60 my-3">
      Loading analytics...
    </p>
  );
}
export function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="font-normal text-[10px] text-black/60 mb-2">{label}</div>
      <div className="font-medium text-[19px] text-black mb-1">{value}</div>
      {note && (
        <div className="font-normal text-[9.5px] text-black/60">{note}</div>
      )}
    </div>
  );
}
export function DataTable({
  caption,
  headings,
  rows,
}: {
  caption: string;
  headings: string[];
  rows: (string | number)[][];
}) {
  return (
    <div
      className="overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-label={caption}
    >
      <table className="w-full text-left border-collapse">
        <caption className="font-medium text-[11px] text-black mb-3 text-left">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-gray-200">
            {headings.map((h) => (
              <th
                scope="col"
                key={h}
                className="font-medium text-[9.5px] text-black py-2"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-100">
              {row.map((v, j) => (
                <td key={j} className="text-[10px] text-black py-2">
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="text-[10px] text-black/60">No records for this period.</p>
      )}
    </div>
  );
}

export function AnalyticsClock() {
  return (
    <svg
      aria-hidden="true"
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="black"
      strokeWidth="1.5"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
