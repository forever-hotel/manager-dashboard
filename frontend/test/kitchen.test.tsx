import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import KitchenQueue from '@/components/KitchenQueue';
import { kitchenSnapshotSchema } from '@/lib/kitchen';
import { kitchenOrderId, kitchenSnapshot } from './kitchen-fixture';
vi.mock('socket.io-client', () => ({ io: vi.fn() }));
let handlers: Record<string, (value?: unknown) => void>;
let fetchMock: ReturnType<typeof vi.fn>;
const event = {
  eventId: '77f4568c-89ab-4c12-b321-123456789012',
  type: 'kitchen.order.changed' as const,
  orderId: kitchenOrderId,
  version: 3,
  occurredAt: '2026-10-19T02:00:00Z'
};
let data = kitchenSnapshot();
beforeEach(() => {
  vi.mocked(io).mockReset();
  handlers = {};
  data = kitchenSnapshot();
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
        JSON.stringify(url.includes('ticket') ? { ticket: 'a'.repeat(43), socketUrl: 'http://localhost:4000' } : data)
      )
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('DDP-026 live kitchen', () => {
  it('shows only the three active groups without obsolete queue controls', async () => {
    render(<KitchenQueue />);
    expect(await screen.findByText('Room 101')).toBeVisible();
    for (const label of ['New', 'Preparing', 'Ready']) expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByText(/Delivered/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Kitchen connection and paging')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/kitchen/orders?activeOnly=true&page=1&pageSize=100',
      expect.anything()
    );
  });
  it('TC-MAD-026-AC2: rereads authoritative snapshots on kitchen events', async () => {
    render(<KitchenQueue />);
    await screen.findByText('Room 101');
    await waitFor(() => expect(handlers['kitchen.order.changed']).toBeDefined());
    data = kitchenSnapshot('READY');
    await act(async () => {
      handlers['kitchen.order.changed'](event);
    });
    expect(within(screen.getByLabelText('Ready for Delivery')).getByText('Room 101')).toBeVisible();
    expect(screen.getAllByText('Room 101')).toHaveLength(1);
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      handlers['kitchen.order.changed'](event);
      handlers['kitchen.order.changed']({ ...event, version: 2 });
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });
  it('TC-MAD-026-AC3: marks disconnect stale, refreshes on reconnect and supports manual retry', async () => {
    render(<KitchenQueue />);
    await screen.findByText('Room 101');
    await waitFor(() => expect(handlers.disconnect).toBeDefined());
    act(() => handlers.disconnect());
    expect(screen.getByRole('status')).toHaveTextContent('stale');
    data = {
      ...kitchenSnapshot(),
      orders: [],
      counts: { PLACED: 0, IN_PREPARATION: 0, READY: 0, DELIVERED: 0 },
      total: 0
    };
    await act(async () => {
      handlers.connect();
      handlers['transport.status']({ healthy: true });
    });
    await waitFor(() => expect(screen.queryByText('Room 101')).not.toBeInTheDocument());
    act(() => handlers['transport.status']({ healthy: false }));
    expect(screen.getByRole('status')).toHaveTextContent('unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(vi.mocked(io).mock.calls.length).toBeGreaterThan(1));
  });
  it('preserves the last snapshot on outage but clears protected data after auth failure', async () => {
    render(<KitchenQueue />);
    await screen.findByText('Room 101');
    await waitFor(() => expect(handlers['kitchen.order.changed']).toBeDefined());
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    await act(async () => handlers['kitchen.order.changed'](event));
    expect(screen.getByText('Room 101')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('stale');
    fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }));
    await act(async () => handlers['kitchen.order.changed']({ ...event, version: 4 }));
    expect(screen.queryByText('Room 101')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('sign in');
  });
  it('rejects duplicate authoritative snapshot rows', () => {
    expect(
      kitchenSnapshotSchema.safeParse({
        ...data,
        orders: [...data.orders, ...data.orders]
      }).success
    ).toBe(false);
  });
  it('stops automatically reconnecting after five attempts and leaves manual retry available', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      async (url: string) =>
        new Response(JSON.stringify(url.includes('ticket') ? {} : data), {
          status: url.includes('ticket') ? 503 : 200
        })
    );
    render(<KitchenQueue />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('five attempts');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    const ticketCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('ticket')).length;
    expect(ticketCalls()).toBe(6); // Initial connection plus five retries.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(ticketCalls()).toBe(6);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(ticketCalls()).toBe(7);
  });
  it.each([401, 403])('never restores a late kitchen snapshot after ticket rejection %s', async status => {
    const socketCallsBefore = vi.mocked(io).mock.calls.length;
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation((url: string) =>
      url.includes('ticket')
        ? Promise.resolve(new Response('{}', { status }))
        : new Promise<Response>(resolve => {
            finish = resolve;
          })
    );
    render(<KitchenQueue />);
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(status === 401 ? 'sign in' : 'Manager access')
    );
    await act(async () => {
      finish(new Response(JSON.stringify(data)));
    });
    expect(screen.queryByText('Room 101')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(status === 401 ? 'sign in' : 'Manager access');
    expect(io).toHaveBeenCalledTimes(socketCallsBefore);
  });
});
