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
          url.includes('food-orders')
            ? foodFixture()
            : url.includes('service-requests')
              ? serviceFixture()
              : workerFixture()
        )
      )
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
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
  it('AC1/AC2: distinguishes no completed average from a zero count and labels all-date backlog', async () => {
    render(<OperationsAnalytics type="service-requests" />);
    await screen.findByText('4', { exact: true });
    fireEvent.click(screen.getByText('Detailed analytics and exports', { selector: 'summary' }));
    expect(screen.getByText('4', { exact: true })).toBeVisible();
    expect(screen.getByRole('table', { name: 'Requests by current status' })).toHaveTextContent('IN PROGRESS');
    expect(screen.getByText(/Backlog includes open requests across all dates/)).toBeVisible();
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
    expect(screen.getByRole('link', { name: 'Submitted complaints' })).toHaveAttribute(
      'href',
      '/complaints?workerId=' + workerId + '&status=SUBMITTED'
    );
    expect(
      screen.getByRole('group', {
        name: 'worker-performance report downloads'
      })
    ).toBeVisible();
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
  it('AC2/AC3: validates worker filter and retains it on period changes', async () => {
    render(<WorkerAnalytics />);
    await screen.findByText('Worker One');
    fireEvent.change(screen.getByLabelText('Worker ID'), {
      target: { value: 'bad' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply worker filter' }));
    expect(screen.getByRole('alert')).toHaveTextContent('valid worker ID');
    fireEvent.change(screen.getByLabelText('Worker ID'), {
      target: { value: workerId }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply worker filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/analytics/operations/worker-performance?period=day&workerId=' + workerId,
        expect.any(Object)
      )
    );
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
    fireEvent.change(screen.getByLabelText('Sort workers'), {
      target: { value: 'openComplaintCount' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ascending' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next workers' }));
    expect(screen.getByText(/Page 2 of 2/)).toBeVisible();
    expect(screen.getByText('Worker 10')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Previous workers' }));
    expect(screen.getByText(/Page 1 of 2/)).toBeVisible();
  });
});
