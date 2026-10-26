'use client';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { type Period } from '@/lib/analytics';
import { workerSchema, sortWorkers, localBoundary, type SortKey } from '@/lib/operations-analytics';
import { useAnalyticsSnapshot } from './useAnalyticsSnapshot';
import { AnalyticsFailure } from './AnalyticsControls';
import { PageHeader, SummaryCard, DataPanel, UnavailableRow } from './DashboardVisuals';
import { statusColor } from '@/lib/status-color';
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
    <main className="dashboard-page">
      <PageHeader title="Worker Performance" period={period} onPeriodChange={choose} />
      <div className="summary-grid">
        <SummaryCard label="Total Workers" value={data ? String(data.workers.length) : '\u2014'} />
        <SummaryCard label="Active Today" value={'\u2014'} tone="success" note="Daily attendance unavailable" />
        <SummaryCard label="Pending Tasks" value={'\u2014'} tone="warning" note="See task queue" />
        <SummaryCard
          label="Issues Reported"
          value={data ? String(data.workers.reduce((sum, w) => sum + w.openComplaintCount, 0)) : '\u2014'}
          tone="danger"
          note="Currently open complaints"
        />
      </div>
      {!data && <AnalyticsFailure error={error} retry={retry} />}
      <DataPanel title="Worker performance" className="worker-design-table">
        <div className="overflow-x-auto">
          <table className="dashboard-table">
            <thead>
              <tr>
                {['Name', 'Role', 'Tasks Completed', 'Performance', 'Status'].map(label => (
                  <th scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordered.slice((page - 1) * 10, page * 10).map(w => (
                <tr key={w.workerId}>
                  <td>{w.fullName}</td>
                  <td>
                    {w.role
                      .toLowerCase()
                      .replaceAll('_', ' ')
                      .replace(/\b\w/g, char => char.toUpperCase())}
                  </td>
                  <td>{w.completedTaskCount}</td>
                  <td title="A performance-rating policy has not been agreed">&mdash;</td>
                  <td>
                    <span className={'status-badge ' + statusColor(w.isActive ? 'ACTIVE' : 'INACTIVE')}>
                      {w.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
              {!ordered.length && (
                <UnavailableRow
                  columns={5}
                  message={data ? 'No workers match these filters.' : 'Worker summary unavailable.'}
                />
              )}
            </tbody>
          </table>
        </div>
      </DataPanel>
      <details className="advanced-controls">
        <summary>Worker filters, detailed metrics, exports and task queue</summary>
        <form
          className="flex flex-wrap items-end gap-3 mb-4"
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
              className="block border border-border rounded-md p-2"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              aria-invalid={!!filterError}
            />
          </label>
          <button type="submit" className="button button-secondary">
            Apply worker filter
          </button>
        </form>
        {filterError && <p role="alert">{filterError}</p>}
        <label>
          Sort workers
          <select
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
          className="button button-ghost"
          aria-pressed={descending}
          onClick={() => {
            setDescending(v => !v);
            setPage(1);
          }}
        >
          {descending ? 'Descending' : 'Ascending'}
        </button>
        <ReportDownload type="worker-performance" filters={{ period, ...(workerId ? { workerId } : {}) }} />
        <p className="page-note">
          Exports include all matching workers; paging affects this table only. Performance ratings and attendance are
          not supplied by the reporting API.
        </p>
        <table className="dashboard-table">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Average elapsed minutes</th>
              <th>Open complaints</th>
              <th>Data quality</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map(w => (
              <tr key={w.workerId}>
                <td>{w.fullName}</td>
                <td>{w.averageCompletionMinutes ?? '\u2014'}</td>
                <td>
                  {w.openComplaintCount}
                  {w.openComplaintCount > 0 && (
                    <>
                      <a className="block" href={'/complaints?workerId=' + w.workerId + '&status=SUBMITTED'}>
                        Submitted complaints
                      </a>
                      <a className="block" href={'/complaints?workerId=' + w.workerId + '&status=UNDER_REVIEW'}>
                        Under review
                      </a>
                    </>
                  )}
                </td>
                <td>
                  {w.dataQuality.status}; excluded: {w.excludedDurationCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="page-note">
          Page {page} of {Math.max(1, Math.ceil(ordered.length / 10))}.
        </p>
        <button disabled={page === 1} onClick={() => setPage(n => n - 1)} className="button button-secondary">
          Previous workers
        </button>
        <button
          disabled={page * 10 >= ordered.length}
          onClick={() => setPage(n => n + 1)}
          className="button button-secondary"
        >
          Next workers
        </button>
        {data && (
          <p className="page-note">
            {localBoundary(data.start)} to {localBoundary(data.end)}. Durations include waiting time. Retrieved:{' '}
            {data.freshness.queriedAt}.
          </p>
        )}
        <TaskQueue />
      </details>
    </main>
  );
}
