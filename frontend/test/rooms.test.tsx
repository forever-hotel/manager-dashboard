import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io } from 'socket.io-client';
import RoomsPage from '@/app/(dashboard)/rooms/page';
import { roomsSnapshot } from './rooms-fixture';
vi.mock('socket.io-client', () => ({ io: vi.fn() }));
let handlers: Record<string, (value?: unknown) => void>;
let fetchMock: ReturnType<typeof vi.fn>;
let data = roomsSnapshot();
beforeEach(() => {
  handlers = {};
  data = roomsSnapshot();
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
describe('DDP-028 room board', () => {
  it('AC1/AC3: renders all four states on actual source floors without mutation controls', async () => {
    render(<RoomsPage />);
    await screen.findByLabelText(/^Room 101,/);
    expect(screen.getByText('Floor 0')).toBeVisible();
    expect(screen.getByText('Floor 2')).toBeVisible();
    for (const room of data.rooms)
      expect(screen.getByLabelText(`Room ${room.number}, ${room.label}, Deluxe`)).toBeVisible();
    expect(screen.queryByRole('button', { name: /edit|claim|assign/i })).not.toBeInTheDocument();
    for (const name of ['Day', 'Week', 'Month']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    expect(screen.queryByText('Room connection details')).not.toBeInTheDocument();
  });
  it('AC2: rereads authoritative data on events and reconnect', async () => {
    render(<RoomsPage />);
    await screen.findByLabelText(/^Room 101,/);
    await waitFor(() => expect(handlers['room.status.changed']).toBeDefined());
    data.rooms[0].status = 'OCCUPIED';
    data.rooms[0].label = 'Occupied';
    await act(async () => {
      handlers['room.status.changed']({ room: { label: 'forged' } });
    });
    expect(screen.getByLabelText('Room 101, Occupied, Deluxe')).toBeVisible();
    expect(screen.queryByText('forged')).not.toBeInTheDocument();
    const count = fetchMock.mock.calls.length;
    await act(async () => {
      handlers.connect();
      handlers['rooms.transport.status']({ healthy: true });
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(count);
  });
  it('keeps last data visible on network failure and supports retry', async () => {
    render(<RoomsPage />);
    await screen.findByLabelText(/^Room 101,/);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      handlers['room.status.changed']();
    });
    expect(screen.getByRole('status')).toHaveTextContent('stale');
    expect(screen.getByLabelText(/^Room 101,/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByLabelText(/^Room 101,/);
  });
  it.each([401, 403])('clears protected data after authorization failure %s', async status => {
    render(<RoomsPage />);
    await screen.findByLabelText(/^Room 101,/);
    fetchMock.mockResolvedValueOnce(new Response('{}', { status }));
    await act(async () => {
      handlers['room.status.changed']();
    });
    expect(screen.queryByLabelText(/^Room 101,/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(status === 401 ? 'sign in' : 'Manager access');
  });
  it('shows an empty successful snapshot explicitly', async () => {
    data.rooms = [];
    render(<RoomsPage />);
    expect(await screen.findByText('No rooms available.')).toBeVisible();
  });
  it('bounds reconnect attempts and leaves retry available during broker failure', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      async (url: string) =>
        new Response(JSON.stringify(url.includes('ticket') ? {} : data), {
          status: url.includes('ticket') ? 503 : 200
        })
    );
    render(<RoomsPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(32000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('five attempts');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    const ticketCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).includes('ticket')).length;
    expect(ticketCalls()).toBe(6);
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
  it('does not restore protected data when a late snapshot follows ticket rejection', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation((url: string) =>
      url.includes('ticket')
        ? Promise.resolve(new Response('{}', { status: 401 }))
        : new Promise<Response>(resolve => {
            finish = resolve;
          })
    );
    render(<RoomsPage />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('sign in'));
    await act(async () => {
      finish(new Response(JSON.stringify(data)));
    });
    expect(screen.queryByLabelText(/^Room 101,/)).not.toBeInTheDocument();
  });
  it('marks disconnect stale and reconnects using a fresh ticket', async () => {
    vi.useFakeTimers();
    render(<RoomsPage />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const calls = fetchMock.mock.calls.length;
    act(() => {
      handlers.disconnect();
      handlers.connect_error();
    });
    expect(screen.getByRole('status')).toHaveTextContent('stale');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });
});
