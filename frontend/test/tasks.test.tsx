import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import TaskQueue from '@/components/TaskQueue';
import { tasksSnapshot, workerId } from './tasks-fixture';
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
    expect(await screen.findByText(`Worker One (${workerId})`)).toBeVisible();
    for (const name of ['Unassigned', 'Assigned', 'In Progress', 'Completed', 'Escalated'])
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^claim|^assign|^complete/i })).not.toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Worker ID'), {
      target: { value: 'bad' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply worker filter' }));
    expect(screen.getByRole('alert')).toHaveTextContent('valid worker ID');
  });
  it('AC2: retains status, worker and page during event and reconnect refreshes', async () => {
    render(<TaskQueue />);
    await screen.findByText('101');
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'ASSIGNED' }
    });
    fireEvent.change(screen.getByLabelText('Worker ID'), {
      target: { value: workerId }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply worker filter' }));
    await screen.findByText('101');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText(/Page 2/);
    await screen.findByText('101');
    const expected = `/api/tasks?page=2&pageSize=20&status=ASSIGNED&worker=${workerId}`;
    await act(async () => {
      handlers['task.changed']();
      handlers.connect();
    });
    expect(fetchMock).toHaveBeenCalledWith(expected, expect.any(Object));
    expect(screen.getByLabelText('Status')).toHaveValue('ASSIGNED');
    expect(screen.getByLabelText('Worker ID')).toHaveValue(workerId);
    expect(screen.getByText(/Page 2/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText(/Page 1/);
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
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
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
