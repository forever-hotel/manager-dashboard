import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import KitchenQueue from '@/components/KitchenQueue';
import { KitchenVersions, kitchenSnapshotSchema } from '@/lib/kitchen';
import { kitchenOrderId, kitchenSnapshot } from './kitchen-fixture';
vi.mock('socket.io-client', () => ({ io: vi.fn() }));
let handlers: Record<string, (value?: unknown) => void>;
let fetchMock: ReturnType<typeof vi.fn>;
const event = {
  eventId: '77f4568c-89ab-4c12-b321-123456789012',
  type: 'kitchen.order.changed' as const,
  orderId: kitchenOrderId,
  version: 3,
  occurredAt: '2026-10-19T02:00:00Z',
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
    disconnect: vi.fn(),
  } as unknown as ReturnType<typeof io>);
  fetchMock = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes('ticket')
            ? { ticket: 'a'.repeat(43), socketUrl: 'http://localhost:4000' }
            : data,
        ),
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('DDP-026 live kitchen', () => {
  it('TC-MAD-026-AC1: shows four mapped groups inside the existing three-column layout', async () => {
    render(<KitchenQueue />);
    expect(await screen.findByText('Room 101')).toBeVisible();
    for (const label of [
      'Pending',
      'In Preparation',
      'Ready for Delivery',
      'Delivered',
    ])
      expect(screen.getByText(label)).toBeVisible();
    expect(
      within(screen.getByLabelText('Pending')).getByText('1'),
    ).toBeVisible();
    expect(screen.getByLabelText('Ready for Delivery').parentElement).toBe(
      screen.getByLabelText('Delivered').parentElement,
    );
  });
  it('TC-MAD-026-AC2: reconciles a status change exactly once and ignores duplicate/older versions', async () => {
    render(<KitchenQueue />);
    await screen.findByText('Room 101');
    await waitFor(() =>
      expect(handlers['kitchen.order.changed']).toBeDefined(),
    );
    data = kitchenSnapshot('READY');
    await act(async () => {
      handlers['kitchen.order.changed'](event);
    });
    expect(
      within(screen.getByLabelText('Ready for Delivery')).getByText('Room 101'),
    ).toBeVisible();
    expect(screen.getAllByText('Room 101')).toHaveLength(1);
    const calls = fetchMock.mock.calls.length;
    await act(async () => {
      handlers['kitchen.order.changed'](event);
      handlers['kitchen.order.changed']({ ...event, version: 2 });
    });
    expect(fetchMock.mock.calls).toHaveLength(calls);
  });
  it('TC-MAD-026-AC3: marks disconnect stale, refreshes on reconnect and supports manual retry', async () => {
    render(<KitchenQueue />);
    await screen.findByText('Room 101');
    await waitFor(() => expect(handlers.disconnect).toBeDefined());
    act(() => handlers.disconnect());
    expect(screen.getByRole('status')).toHaveTextContent('stale');
    data = kitchenSnapshot('DELIVERED');
    await act(async () => {
      handlers.connect();
      handlers['transport.status']({ healthy: true });
    });
    await waitFor(() =>
      expect(
        within(screen.getByLabelText('Delivered')).getByText('Room 101'),
      ).toBeVisible(),
    );
    act(() => handlers['transport.status']({ healthy: false }));
    expect(screen.getByRole('status')).toHaveTextContent('unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(vi.mocked(io).mock.calls.length).toBeGreaterThan(1),
    );
  });
  it('preserves the last snapshot on outage but clears protected data after auth failure', async () => {
    render(<KitchenQueue />);
    await screen.findByText('Room 101');
    await waitFor(() =>
      expect(handlers['kitchen.order.changed']).toBeDefined(),
    );
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    await act(async () => handlers['kitchen.order.changed'](event));
    expect(screen.getByText('Room 101')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('stale');
    fetchMock.mockImplementation(
      async () => new Response('{}', { status: 401 }),
    );
    await act(async () =>
      handlers['kitchen.order.changed']({ ...event, version: 4 }),
    );
    expect(screen.queryByText('Room 101')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('sign in');
  });
  it('rejects duplicate snapshot rows and bounds deduplication state', () => {
    expect(
      kitchenSnapshotSchema.safeParse({
        ...data,
        orders: [...data.orders, ...data.orders],
      }).success,
    ).toBe(false);
    const versions = new KitchenVersions();
    expect(versions.accept(event)).toBe(true);
    expect(versions.accept(event)).toBe(false);
    for (let i = 0; i < 2001; i++)
      versions.accept({ ...event, orderId: String(i) });
    expect(versions.accept(event)).toBe(true);
  });
  it('stops automatically reconnecting after five attempts and leaves manual retry available', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      async (url: string) =>
        new Response(JSON.stringify(url.includes('ticket') ? {} : data), {
          status: url.includes('ticket') ? 503 : 200,
        }),
    );
    render(<KitchenQueue />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('five attempts');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  });
});
