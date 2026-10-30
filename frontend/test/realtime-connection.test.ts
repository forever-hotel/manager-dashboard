import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { io } from 'socket.io-client';
import { subscribeRealtime } from '@/lib/realtime-connection';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());
it('shares one gateway socket between page and notification subscribers', async () => {
  const handlers: Record<string, (data?: unknown) => void> = {};
  const disconnect = vi.fn();

  vi.mocked(io).mockReturnValue({
    on: (name: string, fn: (data?: unknown) => void) => {
      handlers[name] = fn;
    },
    removeAllListeners: vi.fn(),
    disconnect
  } as unknown as ReturnType<typeof io>);
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ ticket: 'a'.repeat(43), socketUrl: 'http://localhost:8080' })));

  vi.stubGlobal('fetch', fetcher);
  const first = vi.fn(),
    second = vi.fn();
  const stopFirst = subscribeRealtime(first),
    stopSecond = subscribeRealtime(second);

  try {
    await waitFor(() => expect(io).toHaveBeenCalled());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(io).toHaveBeenCalledWith('http://localhost:8080', expect.objectContaining({ path: '/realtime/socket.io' }));
    handlers['analytics.changed']({ changed: true });
    expect(first).toHaveBeenCalledWith('analytics.changed', { changed: true });
    expect(second).toHaveBeenCalledWith('analytics.changed', { changed: true });
    stopFirst();
    expect(disconnect).not.toHaveBeenCalled();
  } finally {
    stopFirst();
    stopSecond();
  }
  expect(disconnect).toHaveBeenCalledTimes(1);
});
