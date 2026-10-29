'use client';
import Pagination from './Pagination';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Period } from '@/lib/analytics';
import { workerSchema, sortWorkers, type Worker, type SortKey } from '@/lib/operations-analytics';
import { hotelDate } from '@/lib/analytics-period';
import { useAnalyticsSnapshot } from './useAnalyticsSnapshot';
import { AnalyticsFailure } from './AnalyticsControls';
import { PageHeader, SummaryCard, DataPanel, UnavailableRow } from './DashboardVisuals';
import AnalyticsPeriodNavigation from './AnalyticsPeriodNavigation';
import RowActions from './RowActions';
import { statusColor } from '@/lib/status-color';
import TaskQueue from './TaskQueue';
export default function WorkerAnalytics() {
  const [period, setPeriod] = useState<Period>('week');
  const [date, setDate] = useState(hotelDate);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('fullName');
  const [descending, setDescending] = useState(false);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Worker>();
  const [showTasks, setShowTasks] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const { data, error, retry } = useAnalyticsSnapshot(
    '/api/analytics/operations/worker-performance?' + new URLSearchParams({ period, date }),
    workerSchema
  );
  const ordered = useMemo(
    () =>
      sortWorkers(data?.workers ?? [], sort, descending).filter(w =>
        (w.fullName + ' ' + w.role).toLowerCase().includes(search.toLowerCase().trim())
      ),
    [data, sort, descending, search]
  );
  useEffect(() => {
    if (!selected && !showTasks) return;
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    element?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [selected, showTasks]);
  function close() {
    setSelected(undefined);
    setShowTasks(false);
  }
  function reset() {
    setPage(1);
    close();
  }
  return (
    <main className="dashboard-page worker-performance-page">
      <PageHeader
        title="Worker Performance"
        period={period}
        onPeriodChange={value => {
          setPeriod(value);
          reset();
        }}
      />
      <AnalyticsPeriodNavigation
        period={period}
        date={date}
        scope="worker performance"
        onChange={value => {
          setDate(value);
          reset();
        }}
      />
      <div className="summary-grid">
        <SummaryCard label="Total workers" value={data ? String(data.workers.length) : '?'} />
        <SummaryCard
          label="Active accounts"
          value={data ? String(data.workers.filter(w => w.isActive).length) : '?'}
          tone="success"
          note="Current account status, not attendance"
        />
        <SummaryCard
          label={'Tasks completed (' + period + ')'}
          value={data ? String(data.workers.reduce((sum, w) => sum + w.completedTaskCount, 0)) : '?'}
        />
        <SummaryCard
          label="Issues reported"
          value={data ? String(data.workers.reduce((sum, w) => sum + w.openComplaintCount, 0)) : '?'}
          tone="danger"
          note="Currently open complaints"
        />
      </div>
      {!data && <AnalyticsFailure error={error} retry={retry} />}
      <div className="worker-toolbar">
        <label>
          Search workers
          <input
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Sort workers
          <select
            value={sort}
            onChange={e => {
              setSort(e.target.value as SortKey);
              setPage(1);
            }}
          >
            <option value="fullName">Name</option>
            <option value="completedTaskCount">Completed tasks</option>
            <option value="averageCompletionMinutes">Average completion time</option>
            <option value="openComplaintCount">Open complaints</option>
          </select>
        </label>
        <button
          type="button"
          className="button button-secondary"
          aria-pressed={descending}
          onClick={() => {
            setDescending(v => !v);
            setPage(1);
          }}
        >
          {descending ? 'Descending' : 'Ascending'}
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
            setSelected(undefined);
            setShowTasks(true);
          }}
        >
          View task queue
        </button>
      </div>
      <DataPanel title="Worker performance" className="worker-design-table">
        <div className="overflow-x-auto">
          <table className="dashboard-table">
            <caption className="sr-only">Worker performance in minutes, current filters</caption>
            <thead>
              <tr>
                {['Name', 'Role', 'Tasks completed', 'Average completion', 'Status', 'Actions'].map(label => (
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
                  <td>{w.role.toLowerCase().replaceAll('_', ' ')}</td>
                  <td>{w.completedTaskCount}</td>
                  <td>
                    {w.averageCompletionMinutes === null ? 'N/A' : w.averageCompletionMinutes.toFixed(1) + ' min'}
                  </td>
                  <td>
                    <span className={'status-badge ' + statusColor(w.isActive ? 'ACTIVE' : 'INACTIVE')}>
                      {w.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <RowActions label={'Actions for ' + w.fullName}>
                      <button type="button" onClick={() => setSelected(w)}>
                        View details
                      </button>
                    </RowActions>
                  </td>
                </tr>
              ))}
              {!ordered.length && (
                <UnavailableRow
                  columns={6}
                  message={data ? 'No workers match these filters.' : 'Worker summary unavailable.'}
                />
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={10} total={ordered.length} noun="workers" onChange={setPage} />
      </DataPanel>
      {(selected || showTasks) && (
        <dialog
          ref={dialog}
          tabIndex={-1}
          className="success-dialog complaint-dialog"
          aria-labelledby="worker-dialog-title"
          onCancel={close}
        >
          <div className="flex justify-between items-center gap-3 mb-4">
            <h2 id="worker-dialog-title">{selected ? selected.fullName : 'Worker task queue'}</h2>
            <button type="button" className="button button-secondary" onClick={close}>
              Close details
            </button>
          </div>
          {selected ? (
            <>
              <dl className="complaint-detail-grid">
                <dt>Tasks completed</dt>
                <dd>{selected.completedTaskCount}</dd>
                <dt>Average completion</dt>
                <dd>
                  {selected.averageCompletionMinutes === null
                    ? 'N/A'
                    : selected.averageCompletionMinutes.toFixed(1) + ' min'}
                </dd>
                <dt>Open complaints</dt>
                <dd>{selected.openComplaintCount}</dd>
                <dt>Data quality</dt>
                <dd>{selected.dataQuality.status}</dd>
                <dt>Excluded durations</dt>
                <dd>{selected.excludedDurationCount}</dd>
              </dl>
              <p className="text-xs text-muted">
                Durations include waiting time. Performance ratings and attendance are not provided.
              </p>
              {selected.openComplaintCount > 0 && (
                <div className="flex flex-wrap gap-3">
                  <a
                    className="button button-secondary"
                    href={'/complaints?workerId=' + selected.workerId + '&status=SUBMITTED'}
                  >
                    Submitted complaints
                  </a>
                  <a
                    className="button button-secondary"
                    href={'/complaints?workerId=' + selected.workerId + '&status=UNDER_REVIEW'}
                  >
                    Under review
                  </a>
                </div>
              )}
            </>
          ) : (
            <TaskQueue />
          )}
        </dialog>
      )}
    </main>
  );
}
