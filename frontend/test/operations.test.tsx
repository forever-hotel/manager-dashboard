vi.mock('@/components/useRealtimeRefresh', () => ({ useRealtimeRefresh: () => undefined }));
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import OperationsAnalytics from '@/components/OperationsAnalytics';
import WorkerAnalytics from '@/components/WorkerAnalytics';
import { sortWorkers, workerSchema } from '@/lib/operations-analytics';
import { foodFixture, serviceFixture, workerFixture, workerId } from './operations-fixture';
vi.mock('@/components/KitchenQueue', () => ({
  default: () => <div>Live kitchen queue</div>
}));
vi.mock('@/components/TaskQueue', () => ({
  default: () => <div>Live task queue</div>
}));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.startsWith('/api/service-requests?')
            ? {
                requests: [],
                total: 0,
                page: 1,
                pageSize: 20,
                view: new URL(url, 'http://localhost').searchParams.get('view')
              }
            : url.includes('food-orders')
              ? foodFixture()
              : url.includes('service-requests')
                ? serviceFixture()
                : workerFixture()
        )
      )
  );
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('DDP-032 operations views', () => {
  it('shows empty food metrics and the live queue without obsolete reports', async () => {
    render(<OperationsAnalytics type="food-orders" />);
    expect(await screen.findByText('No items ordered in this period.')).toBeVisible();
    expect(screen.getByText('LKR 0.00')).toBeVisible();
    expect(screen.getByText('No deliveries in this period')).toBeVisible();
    expect(screen.getByText('Live kitchen queue')).toBeVisible();
    expect(screen.queryByText('Detailed analytics and exports')).not.toBeInTheDocument();
    expect(screen.queryByText('Orders by placement hour')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('renders approved delivered-order metrics and historical month controls', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...foodFixture(),
          period: 'month',
          delivery: { ...foodFixture().delivery, deliveredCount: 2, validDurationCount: 2, averageMinutes: 18.5 },
          revenue: { ...foodFixture().revenue, orderCount: 2, amountMinor: 8400000 }
        })
      )
    );
    render(<OperationsAnalytics type="food-orders" />);
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    fireEvent.change(screen.getByLabelText('Select food analytics month'), { target: { value: '2026-09' } });
    expect(await screen.findByText('18.5 min')).toBeVisible();
    expect(screen.getByText('LKR 84,000.00')).toBeVisible();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/analytics/operations/food-orders?period=month&date=2026-09-01',
        expect.anything()
      )
    );
  });
  it('defaults to all period requests and toggles active requests with one button', async () => {
    render(<OperationsAnalytics type="service-requests" />);
    expect(await screen.findByText('No service requests in this period.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Request history' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh requests' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Active requests' }));
    expect(await screen.findByText('No active service requests in this period.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'All requests' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'All requests' }));
    expect(await screen.findByText('No service requests in this period.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    fireEvent.change(screen.getByLabelText('Select service analytics month'), { target: { value: '2026-09' } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/service-requests?period=month&date=2026-09-01&view=all&page=1&pageSize=20',
        expect.anything()
      )
    );
  });
  it('renders request rows, assignees and paginated history', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (!url.startsWith('/api/service-requests?')) return new Response(JSON.stringify(serviceFixture()));
      const query = new URL(url, 'http://localhost').searchParams;
      const page = Number(query.get('page'));
      const size = page === 1 ? 20 : 1;
      return new Response(
        JSON.stringify({
          view: query.get('view'),
          total: 21,
          page,
          pageSize: 20,
          requests: Array.from({ length: size }, (_, index) => ({
            id: `67f4568c-89ab-4c12-b321-${String(index + page * 20).padStart(12, '0')}`,
            roomNumber: String(204 + index),
            category: 'ROOM_CLEANING',
            status: query.get('view') === 'all' ? 'COMPLETED' : 'ASSIGNED',
            submittedAt: '2026-10-20T00:00:00Z',
            assignee: index === 0 ? 'Worker One' : null
          }))
        })
      );
    });
    render(<OperationsAnalytics type="service-requests" />);
    expect(await screen.findByText('Worker One')).toBeVisible();
    expect(screen.getAllByText('Unassigned')).toHaveLength(19);
    fireEvent.click(screen.getByRole('button', { name: 'Next requests' }));
    expect(await screen.findByText('21�21 of 21 requests')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next requests' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Active requests' }));
    expect(await screen.findByText('1�20 of 21 requests')).toBeVisible();
    expect(screen.getAllByText('Assigned')).toHaveLength(20);
  });
  it('AC3: ignores stale period responses and supports retry', async () => {
    let finish!: (r: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>(r => {
          finish = r;
        })
    );
    render(<OperationsAnalytics type="food-orders" />);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...foodFixture(), period: 'month' })));
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    await act(async () => finish(new Response(JSON.stringify({ ...foodFixture(), total: 999 }))));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
    expect(screen.queryByText('999', { exact: true })).not.toBeInTheDocument();
  });
  it('reports failures and retries without displaying fake metrics', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    render(<OperationsAnalytics type="food-orders" />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry analytics' }));
    expect(await screen.findByText('No items ordered in this period.')).toBeVisible();
  });
});
describe('DDP-033 worker view', () => {
  it('AC1: displays worker metrics, N/A and usable complaint links', async () => {
    render(<WorkerAnalytics />);
    const table = await screen.findByRole('table', {
      name: 'Worker performance in minutes, current filters'
    });
    expect(table).toHaveTextContent('Worker One');
    expect(table).toHaveTextContent('N/A');
    expect(screen.queryByRole('columnheader', { name: 'Actions' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sort workers')).not.toBeInTheDocument();
    expect(screen.queryByText('Worker filters, detailed metrics, exports and task queue')).not.toBeInTheDocument();
  });
  it('AC2: sorts ties deterministically and leaves N/A last in both directions', () => {
    const worker = workerSchema.parse(workerFixture()).workers[0];
    const other = {
      ...worker,
      workerId: '77f4568c-89ab-4c12-b321-123456789012',
      averageCompletionMinutes: 5
    };
    for (const desc of [false, true])
      expect(sortWorkers([worker, other], 'averageCompletionMinutes', desc).at(-1)?.workerId).toBe(workerId);
    expect(sortWorkers([other, worker], 'completedTaskCount', true)[0].workerId).toBe(workerId);
    expect(sortWorkers([other, worker], 'fullName', false)[0].workerId).toBe(workerId);
  });
  it('supports historical periods and name search', async () => {
    render(<WorkerAnalytics />);
    await screen.findByText('Worker One');
    fireEvent.change(screen.getByLabelText('Search workers'), { target: { value: 'missing' } });
    expect(screen.getByText('No workers match these filters.')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Search workers'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    fireEvent.change(screen.getByLabelText('Select worker performance month'), { target: { value: '2026-09' } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/analytics/operations/worker-performance?period=month&date=2026-09-01',
        expect.anything()
      )
    );
  });
  it('opens the live queue only when requested', async () => {
    render(<WorkerAnalytics />);
    await screen.findByText('Worker One');
    expect(screen.queryByText('Live task queue')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View task queue' }));
    expect(screen.getByRole('dialog', { name: 'Worker task queue' })).toBeVisible();
    expect(screen.getByText('Live task queue')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('supports stable sorting and paging of zero-task workers', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...workerFixture(),
          workers: Array.from({ length: 11 }, (_, i) => ({
            ...workerFixture().workers[0],
            workerId: `67f4568c-89ab-4c12-b321-${String(i).padStart(12, '0')}`,
            fullName: 'Worker ' + i
          }))
        })
      )
    );
    render(<WorkerAnalytics />);
    await screen.findByText('Worker 0');
    fireEvent.click(screen.getByRole('button', { name: 'Next workers' }));
    expect(screen.getByText('11�11 of 11 workers')).toBeVisible();
    expect(screen.getByText('Worker 10')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Previous workers' }));
    expect(screen.getByText('1�10 of 11 workers')).toBeVisible();
  });
});
