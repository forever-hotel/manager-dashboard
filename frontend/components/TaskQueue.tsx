'use client';
import { useState } from 'react';
import { z } from 'zod';
import { taskLabels, taskStatuses, tasksSnapshotSchema } from '@/lib/tasks';
import { useOperationsSnapshot } from './useOperationsSnapshot';

export default function TaskQueue() {
  const [status, setStatus] = useState('');
  const [worker, setWorker] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const query = new URLSearchParams({ page: String(page), pageSize: '20' });
  if (status) query.set('status', status);
  if (worker) query.set('worker', worker);
  const { snapshot, message, retry } = useOperationsSnapshot(
    '/api/tasks?' + query.toString(),
    tasksSnapshotSchema,
    'tasks.transport.status',
    'task.changed'
  );
  return (
    <section className="rounded-lg border border-gray-200 p-5">
      <h2 className="text-[12px] font-medium text-black">Worker task queue</h2>
      <p className="mt-2 text-sm text-black/60">Read only · WKMS manages task assignment and progress.</p>
      <form
        className="flex flex-wrap items-end gap-4 my-4"
        onSubmit={event => {
          event.preventDefault();
          const value = draft.trim();
          if (value && !z.uuid().safeParse(value).success) {
            setError('Enter a valid worker ID.');
            return;
          }
          setError('');
          setWorker(value);
          setPage(1);
        }}
      >
        <label className="font-normal text-[10.5px] text-black">
          Status
          <select
            className="block border border-gray-200 rounded-md p-2 mt-1"
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
        <label className="font-normal text-[10.5px] text-black">
          Worker ID
          <input
            className="block border border-gray-200 rounded-md p-2 mt-1"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            aria-describedby={error ? 'worker-filter-error' : undefined}
            aria-invalid={!!error}
          />
        </label>
        <button type="submit" className="font-normal text-[10.5px] border border-gray-200 rounded-md p-2">
          Apply worker filter
        </button>
      </form>
      {error && (
        <p id="worker-filter-error" role="alert" className="text-[10px] text-red-600">
          {error}
        </p>
      )}
      {message && (
        <div role="status" className="font-normal text-[10px] text-black/60 mb-3">
          {message}{' '}
          <button type="button" className="underline" onClick={retry}>
            Retry
          </button>
        </div>
      )}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Task queue data">
        <table className="w-full text-left text-[10.5px] text-black">
          <caption className="sr-only">Read-only tasks matching current filters</caption>
          <thead>
            <tr>
              {['Task', 'Room', 'Category', 'Priority', 'Status', 'Worker', 'Submitted', 'Updated', 'Completed'].map(
                title => (
                  <th scope="col" className="font-medium border-b border-gray-200 p-2" key={title}>
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
                  task.assignee ? `${task.assignee.name} (${task.assignee.id})` : 'Unassigned',
                  task.submittedAt,
                  task.updatedAt,
                  task.completedAt ?? '—'
                ].map((value, index) => (
                  <td key={index} className="font-normal border-b border-gray-100 p-2">
                    {value}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {snapshot && snapshot.tasks.length === 0 && (
        <p className="text-[10.5px] text-black/60 my-3">No tasks on this page for these filters.</p>
      )}
      <div className="text-[10.5px] text-black/60 mt-4">
        Page {page}
        {snapshot ? ` · ${snapshot.total} matching tasks` : ''}.{' '}
        <button type="button" className="underline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
          Previous
        </button>{' '}
        <button
          type="button"
          className="underline"
          disabled={!snapshot || page * 20 >= snapshot.total}
          onClick={() => setPage(p => p + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
