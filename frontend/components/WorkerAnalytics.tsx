'use client';
import Pagination from './Pagination';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Period } from '@/lib/analytics';
import { workerSchema } from '@/lib/operations-analytics';
import { hotelDate } from '@/lib/analytics-period';
import { useAnalyticsSnapshot } from './useAnalyticsSnapshot';
import { AnalyticsFailure } from './AnalyticsControls';
import { PageHeader, SummaryCard, DataPanel, UnavailableRow } from './DashboardVisuals';
import AnalyticsPeriodNavigation from './AnalyticsPeriodNavigation';
import { statusColor } from '@/lib/status-color';
import TaskQueue from './TaskQueue';
export default function WorkerAnalytics() {
  const [period, setPeriod] = useState<Period>('week');
  const [date, setDate] = useState(hotelDate);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showTasks, setShowTasks] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const { data, error, retry } = useAnalyticsSnapshot(
    '/api/analytics/operations/worker-performance?' + new URLSearchParams({ period, date }),
    workerSchema
  );
  const ordered = useMemo(
    () =>
      [...(data?.workers ?? [])]
        .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.workerId.localeCompare(b.workerId))
        .filter(w => (w.fullName + ' ' + w.role).toLowerCase().includes(search.toLowerCase().trim())),
    [data, search]
  );
  const currentPage = Math.min(page, Math.max(1, Math.ceil(ordered.length / 10)));
  useEffect(() => {
    if (!showTasks) return;
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    element?.focus();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [showTasks]);
  function close() {
    setShowTasks(false);
  }
  function reset() {
    setPage(1);
    close();
  }
  return (
    <main className="dashboard-page">
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
        <SummaryCard label="Total workers" value={data ? String(data.workers.length) : '\u2014'} />
        <SummaryCard
          label="Active accounts"
          value={data ? String(data.workers.filter(w => w.isActive).length) : '\u2014'}
          tone="success"
          note="Current account status, not attendance"
        />
        <SummaryCard
          label={'Tasks completed (' + period + ')'}
          value={data ? String(data.workers.reduce((sum, w) => sum + w.completedTaskCount, 0)) : '\u2014'}
        />
        <SummaryCard
          label="Issues reported"
          value={data ? String(data.workers.reduce((sum, w) => sum + w.openComplaintCount, 0)) : '\u2014'}
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
        <button
          type="button"
          className="button button-secondary"
          onClick={() => {
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
                {['Name', 'Role', 'Tasks completed', 'Average completion', 'Open complaints', 'Status'].map(label => (
                  <th scope="col" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordered.slice((currentPage - 1) * 10, currentPage * 10).map(w => (
                <tr key={w.workerId}>
                  <td>{w.fullName}</td>
                  <td>{w.role.toLowerCase().replaceAll('_', ' ')}</td>
                  <td>{w.completedTaskCount}</td>
                  <td title="Elapsed time from task submission to completion, including waiting time">
                    {w.averageCompletionMinutes === null ? 'N/A' : w.averageCompletionMinutes.toFixed(1) + ' min'}
                  </td>
                  <td>{w.openComplaintCount}</td>
                  <td>
                    <span className={'status-badge ' + statusColor(w.isActive ? 'ACTIVE' : 'INACTIVE')}>
                      {w.isActive ? 'Active' : 'Inactive'}
                    </span>
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
        <Pagination page={currentPage} pageSize={10} total={ordered.length} noun="workers" onChange={setPage} />
      </DataPanel>
      {showTasks && (
        <dialog
          ref={dialog}
          tabIndex={-1}
          className="success-dialog complaint-dialog worker-queue-dialog"
          aria-labelledby="worker-dialog-title"
          onCancel={close}
        >
          <div className="flex justify-between items-center gap-3 mb-4">
            <h2 id="worker-dialog-title">Worker task queue</h2>
            <button type="button" className="button button-secondary" onClick={close}>
              Close details
            </button>
          </div>
          <TaskQueue />
        </dialog>
      )}
    </main>
  );
}
