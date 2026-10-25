'use client';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { type Period } from '@/lib/analytics';
import { workerSchema, sortWorkers, localBoundary, type SortKey } from '@/lib/operations-analytics';
import { useAnalyticsSnapshot } from './useAnalyticsSnapshot';
import { AnalyticsClock, PeriodButtons, AnalyticsFailure, MetricCard } from './AnalyticsControls';
import ReportDownload from './ReportDownload';
import TaskQueue from './TaskQueue';
export default function WorkerAnalytics() {
  const [period, setPeriod] = useState<Period>('week');
  const [draft, setDraft] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [filterError, setFilterError] = useState('');
  const [sort, setSort] = useState<SortKey>('fullName');
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(1);
  const { data, error, retry } = useAnalyticsSnapshot(
    '/api/analytics/operations/worker-performance?' +
      new URLSearchParams({ period, ...(workerId ? { workerId } : {}) }),
    workerSchema
  );
  const ordered = useMemo(() => sortWorkers(data?.workers ?? [], sort, descending), [data, sort, descending]);
  const choose = (next: Period) => {
    setPeriod(next);
    setPage(1);
  };
  return (
    <main className="flex-1 min-w-0 px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-medium text-[15px] text-black">Worker performance</h1>
        <div className="flex items-center gap-4">
          <PeriodButtons period={period} onChange={choose} />
          <AnalyticsClock />
        </div>
      </div>
      <form
        className="flex gap-3 mb-4 text-[10.5px]"
        onSubmit={e => {
          e.preventDefault();
          const value = draft.trim();
          if (value && !z.uuid().safeParse(value).success) {
            setFilterError('Enter a valid worker ID.');
            return;
          }
          setFilterError('');
          setWorkerId(value);
          setPage(1);
        }}
      >
        <label>
          Worker ID
          <input
            className="block border border-gray-200 rounded-md px-3 py-2"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            aria-invalid={!!filterError}
          />
        </label>
        <button type="submit" className="underline">
          Apply worker filter
        </button>
      </form>
      {filterError && <p role="alert">{filterError}</p>}
      {!data ? (
        <AnalyticsFailure error={error} retry={retry} />
      ) : (
        <>
          <p className="text-[10.5px] text-black/60 mb-3">
            {localBoundary(data.start)} to {localBoundary(data.end)} (exclusive end). Asia/Colombo.
          </p>
          <section className="mb-6">
            <h2 className="font-medium text-[12px] underline text-black mb-3">Worker performance</h2>
            <div className="grid grid-cols-4 gap-4">
              <MetricCard
                label="Tasks completed"
                value={String(data.workers.reduce((n, w) => n + w.completedTaskCount, 0))}
              />
              <MetricCard label="Workers reporting" value={String(data.workers.length)} />
              <MetricCard
                label="Open complaints"
                value={String(data.workers.reduce((n, w) => n + w.openComplaintCount, 0))}
              />
              <MetricCard label="Active workers" value={String(data.workers.filter(w => w.isActive).length)} />
            </div>
            <p className="text-[10px] text-black/60 mt-3">
              Durations start at submission and use valid completed tasks in the period. Open complaints include
              currently open records across all dates. Inactive and historical assignees remain visible.
            </p>
            <ReportDownload type="worker-performance" filters={{ period, ...(workerId ? { workerId } : {}) }} />
            <p className="text-[10px]">
              Exports include all matching workers. Sorting and paging affect this table only.
            </p>
          </section>
          <div className="grid grid-cols-3 gap-4 mb-8">
            <section className="border border-gray-200 rounded-lg p-4">
              <h2 className="font-medium text-[11px] text-black mb-3">Per-worker summary</h2>
              <label className="text-[10.5px]">
                Sort workers
                <select
                  className="block border border-gray-200 rounded-md p-2"
                  value={sort}
                  onChange={e => {
                    setSort(e.target.value as SortKey);
                    setPage(1);
                  }}
                >
                  {[
                    ['fullName', 'Name'],
                    ['completedTaskCount', 'Completed tasks'],
                    ['averageCompletionMinutes', 'Average completion time'],
                    ['openComplaintCount', 'Open complaints']
                  ].map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="text-[10.5px] underline my-2"
                aria-pressed={descending}
                onClick={() => {
                  setDescending(v => !v);
                  setPage(1);
                }}
              >
                {descending ? 'Descending' : 'Ascending'}
              </button>
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Worker performance data">
                <table className="w-full text-left border-collapse text-[10px]">
                  <caption className="sr-only">Worker performance in minutes, current filters</caption>
                  <thead>
                    <tr>
                      {['Worker', 'Completed tasks', 'Average minutes', 'Open complaints'].map(h => (
                        <th key={h} scope="col" className="font-medium text-[9.5px] text-black py-2">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ordered.slice((page - 1) * 10, page * 10).map(w => (
                      <tr key={w.workerId} className="border-b border-gray-100">
                        <td className="py-2">
                          {w.fullName}
                          <p>
                            {w.isActive ? 'Active' : 'Inactive'}; {w.role}; {w.dataQuality.status}
                          </p>
                        </td>
                        <td>{w.completedTaskCount}</td>
                        <td>
                          {w.averageCompletionMinutes === null ? 'N/A' : w.averageCompletionMinutes + ' min'}
                          <p>Excluded: {w.excludedDurationCount}</p>
                        </td>
                        <td>
                          {w.openComplaintCount}
                          {w.openComplaintCount > 0 && (
                            <p>
                              <a
                                className="underline"
                                href={'/complaints?workerId=' + w.workerId + '&status=SUBMITTED'}
                              >
                                Submitted complaints
                              </a>
                              {' / '}
                              <a
                                className="underline"
                                href={'/complaints?workerId=' + w.workerId + '&status=UNDER_REVIEW'}
                              >
                                Under review
                              </a>
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {ordered.length === 0 && <p className="text-[10px]">No workers match these filters.</p>}
              <div className="text-[10px] mt-3">
                Page {page} of {Math.max(1, Math.ceil(ordered.length / 10))}.{' '}
                <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)} className="underline">
                  Previous workers
                </button>{' '}
                <button
                  type="button"
                  disabled={page * 10 >= ordered.length}
                  onClick={() => setPage(p => p + 1)}
                  className="underline"
                >
                  Next workers
                </button>
              </div>
            </section>
            <section className="col-span-2">
              <TaskQueue />
            </section>
          </div>
          <p className="text-[10px] text-black/60">
            Retrieved: {data.freshness.queriedAt}. Data quality covers all tasks assigned to each worker.
          </p>
        </>
      )}
    </main>
  );
}
