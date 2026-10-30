import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import TaskQueue from '@/components/TaskQueue';
import { tasksSnapshot } from './tasks-fixture';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));
let handlers: Record<string, (value?: unknown) => void>;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  handlers = {};
  vi.mocked(io).mockReturnValue({
    on: (name: string, fn: (value?: unknown) => void) => {
      handlers[name] = fn;
    },
    removeAllListeners: vi.fn(),
    disconnect: vi.fn()
  } as unknown as ReturnType<typeof io>);
  fetchMock = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('ticket')
            ? { ticket: 'a'.repeat(43), socketUrl: 'http://localhost:4000' }
            : tasksSnapshot(Number(new URL(url, 'http://localhost').searchParams.get('page')))
        )
      )
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('DDP-028 task queue', () => {
  it('AC1/AC3: exposes all task groups and worker details without mutation controls', async () => {
    render(<TaskQueue />);
    expect(await screen.findByText('Worker One')).toBeVisible();
    expect(screen.queryByLabelText('Worker ID')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply worker filter' })).not.toBeInTheDocument();
    for (const name of ['Unassigned', 'Assigned', 'In Progress', 'Completed', 'Escalated'])
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^claim|^assign|^complete/i })).not.toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeVisible();
  });
  it('AC2: retains status, worker and page during event and reconnect refreshes', async () => {
    render(<TaskQueue />);
    await screen.findByText('101');
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'ASSIGNED' }
    });
    fireEvent.change(screen.getByLabelText('Worker name'), {
      target: { value: 'Worker One' }
    });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('workerName=Worker+One'))).toBe(true));
    await screen.findByText('101');
    fireEvent.click(screen.getByRole('button', { name: 'Next tasks' }));
    await screen.findByText(/21.* tasks/);
    await screen.findByText('101');
    const expected = '/api/tasks?page=2&pageSize=20&status=ASSIGNED&workerName=Worker+One';

    await act(async () => {
      handlers['task.changed']();
      handlers.connect();
    });
    expect(fetchMock).toHaveBeenCalledWith(expected, expect.any(Object));
    expect(screen.getByLabelText('Status')).toHaveValue('ASSIGNED');
    expect(screen.getByLabelText('Worker name')).toHaveValue('Worker One');
    expect(screen.getByText(/21–.* tasks/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Previous tasks' }));
    await screen.findByText(/1–20 of .* tasks/);
  });
  it('shows empty results and disables forward pagination', async () => {
    fetchMock.mockImplementation(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes('ticket')
              ? { ticket: 'a'.repeat(43), socketUrl: 'http://localhost:4000' }
              : { ...tasksSnapshot(), tasks: [], total: 0 }
          )
        )
    );
    render(<TaskQueue />);
    expect(await screen.findByText('No tasks on this page for these filters.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next tasks' })).toBeDisabled();
  });
  it('reports offline transport and refreshes after health recovery', async () => {
    render(<TaskQueue />);
    await screen.findByText('101');
    await waitFor(() => expect(handlers['tasks.transport.status']).toBeDefined());
    await act(async () => {
      handlers['tasks.transport.status']({ healthy: false });
    });
    expect(screen.getByRole('status')).toHaveTextContent('unavailable');
    await act(async () => {
      handlers['tasks.transport.status']({ healthy: true });
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
