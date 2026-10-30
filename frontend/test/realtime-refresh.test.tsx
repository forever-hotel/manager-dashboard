import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRealtimeRefresh } from '@/components/useRealtimeRefresh';

let listener: (name: string) => void;
const stop = vi.fn();
vi.mock('@/lib/realtime-connection', () => ({
  subscribeRealtime: (callback: typeof listener) => {
    listener = callback;
    return stop;
  }
}));
afterEach(() => {
  vi.useRealTimers();
  stop.mockClear();
});
it('coalesces live analytics changes, reconciles missed updates and cleans up', async () => {
  vi.useFakeTimers();
  const refresh = vi.fn();
  const hook = renderHook(() => useRealtimeRefresh('analytics', refresh));

  act(() => {
    listener('analytics.changed');
    listener('analytics.changed');
    listener('food.analytics.changed');
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30000);
  });
  expect(refresh).toHaveBeenCalledTimes(2);
  hook.unmount();
  expect(stop).toHaveBeenCalled();
});
