'use client';
import Pagination from './Pagination';
import { useEffect, useState } from 'react';
import { taskLabels, taskStatuses, tasksSnapshotSchema } from '@/lib/tasks';
import { useOperationsSnapshot } from './useOperationsSnapshot';

const formatTime = (value: string | null) => (value ? value.slice(0, 16).replace('T', ' ') : '\u2014');

export default function TaskQueue() {
  const [status, setStatus] = useState('');
  const [worker, setWorker] = useState('');
  const [draft, setDraft] = useState('');
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status) query.set('status', status);
  if (worker) query.set('workerName', worker);
  const { snapshot, message, retry } = useOperationsSnapshot(
    '/api/tasks?' + query.toString(),
    tasksSnapshotSchema,
    'tasks.transport.status',
    'task.changed'
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      setWorker(draft.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [draft]);
  return (
    <section>
      <div className="flex flex-wrap items-end gap-4 my-4">
        <label className="font-normal text-xs text-ink">
          Status
          <select
            className="block border border-border rounded-md p-2 mt-1"
            value={status}
            onChange={event => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {taskStatuses.map(state => (
              <option key={state} value={state}>
                {taskLabels[state]}
              </option>
            ))}
          </select>
        </label>
        <label className="font-normal text-xs text-ink">
          Worker name
          <input
            className="block border border-border rounded-md p-2 mt-1"
            maxLength={200}
            value={draft}
            onChange={event => setDraft(event.target.value)}
          />
        </label>
      </div>
      {message && (
        <div role="status" className="font-normal text-xs text-muted mb-3">
          {message}{' '}
          <button type="button" className="underline button button-ghost" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Task queue data">
        <table className="w-full text-left text-xs text-ink dashboard-table">
          <caption className="sr-only">Read-only tasks matching current filters</caption>
          <thead>
            <tr>
              {['Task', 'Room', 'Category', 'Priority', 'Status', 'Worker', 'Submitted', 'Updated', 'Completed'].map(
                title => (
                  <th scope="col" className="font-medium border-b border-border p-2" key={title}>
                    {title}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {snapshot?.tasks.map(task => (
              <tr key={task.id}>
                {[
                  task.id,
                  task.roomNumber,
                  task.category.replaceAll('_', ' '),
                  task.priority,
                  taskLabels[task.status],
                  task.assignee?.name ?? 'Unassigned',
                  formatTime(task.submittedAt),
                  formatTime(task.updatedAt),
                  formatTime(task.completedAt)
                ].map((value, index) => (
                  <td
                    key={index}
                    className={'font-normal border-b border-border p-2' + (index >= 6 ? ' whitespace-nowrap' : '')}
                  >
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {snapshot && snapshot.tasks.length === 0 && (
        <p className="text-xs text-muted my-3">No tasks on this page for these filters.</p>
      )}
      <Pagination
        page={page}
        pageSize={20}
        total={snapshot?.total ?? 0}
        noun="tasks"
        disabled={!snapshot}
        onChange={setPage}
      />
    </section>
  );
}
