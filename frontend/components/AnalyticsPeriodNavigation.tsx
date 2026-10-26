'use client';
import { useId } from 'react';
import type { Period } from '@/lib/analytics';
import { hotelDate, shiftAnalyticsDate } from '@/lib/analytics-period';
export default function AnalyticsPeriodNavigation({
  period,
  date,
  onChange,
  range,
  scope = 'analytics'
}: {
  period: Period;
  date: string;
  onChange: (date: string) => void;
  range?: { from: string; to: string };
  scope?: string;
}) {
  const id = useId();
  const previous = shiftAnalyticsDate(date, period, -1),
    next = shiftAnalyticsDate(date, period, 1);
  const format = (value: string) =>
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      new Date(value + 'T12:00:00Z')
    );
  return (
    <div className="analytics-period-navigation" aria-label={scope + ' dates'}>
      <button
        type="button"
        className="button button-secondary"
        disabled={!previous}
        onClick={() => previous && onChange(previous)}
      >
        Previous {period}
      </button>
      <label className="sr-only" htmlFor={id}>
        Select {scope} {period === 'month' ? 'month' : 'date'}
      </label>
      <input
        id={id}
        type={period === 'month' ? 'month' : 'date'}
        min={period === 'month' ? '0001-01' : '0001-01-01'}
        max={period === 'month' ? '9999-12' : '9999-12-31'}
        value={period === 'month' ? date.slice(0, 7) : date}
        onChange={event => {
          const value = period === 'month' ? event.target.value + '-01' : event.target.value;
          if (/^\d{4}-\d{2}-\d{2}$/.test(value)) onChange(value);
        }}
      />
      <button type="button" className="button button-secondary" disabled={!next} onClick={() => next && onChange(next)}>
        Next {period}
      </button>
      <button type="button" className="button button-ghost" onClick={() => onChange(hotelDate())}>
        Current {period}
      </button>
      {range && (
        <span className="period-range">
          {format(range.from)} &ndash; {format(range.to)}
        </span>
      )}
    </div>
  );
}
