vi.mock('@/components/useRealtimeRefresh', () => ({ useRealtimeRefresh: () => undefined }));

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OccupancyCalendar from '@/components/OccupancyCalendar';
import {
  demand,
  hotelMonth,
  leadingDays,
  loadOccupancy,
  monthDates,
  parseOccupancy,
  shiftMonth
} from '@/lib/occupancy';
import { occupancy } from './occupancy-fixture';

afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown) => new Response(JSON.stringify(data));

function setup(data = occupancy()) {
  const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response(data)));

  vi.stubGlobal('fetch', fetchMock);
  render(<OccupancyCalendar initialMonth="2024-02" />);
  return fetchMock;
}
describe('DDP-016 calendar contracts', () => {
  it('uses Gregorian month boundaries and Monday-first weekday positions', () => {
    expect(monthDates('2024-02')).toHaveLength(29);
    expect(monthDates('2023-02')).toHaveLength(28);
    expect(monthDates('1900-02')).toHaveLength(28);
    expect(monthDates('2000-02')).toHaveLength(29);
    expect(leadingDays('2024-02')).toBe(3);
    expect(leadingDays('2024-01')).toBe(0);
    expect(shiftMonth('2024-12', 1)).toBe('2025-01');
    expect(shiftMonth('2024-01', -1)).toBe('2023-12');
    expect(shiftMonth('0001-01', -1)).toBeNull();
    expect(shiftMonth('9999-12', 1)).toBeNull();
    expect(() => monthDates('2024-13')).toThrow();
    expect(hotelMonth(new Date('2024-01-31T19:00:00Z'))).toBe('2024-02');
    expect([null, 0, 0.3999, 0.4, 0.6999, 0.7, 1].map(demand)).toEqual([
      'Unknown',
      'Low',
      'Low',
      'Medium',
      'Medium',
      'High',
      'High'
    ]);
  });
  it('rejects malformed counts, rates, incomplete months and shifted dates', () => {
    expect(parseOccupancy(occupancy(), '2024-02').dates).toHaveLength(29);
    for (const change of [
      { occupiedRooms: 11 },
      { occupiedRooms: -1 },
      { eligibleRooms: 0 },
      { rate: null },
      { rate: 0.7 },
      { date: '2024-02-30' }
    ]) {
      const data = occupancy();

      Object.assign(data.dates[0], change);
      expect(() => parseOccupancy(data, '2024-02')).toThrow();
    }
    const partial = occupancy();

    partial.dates.pop();
    expect(() => parseOccupancy(partial, '2024-02')).toThrow();
    const shifted = occupancy();

    shifted.dates.reverse();
    expect(() => parseOccupancy(shifted, '2024-02')).toThrow();
    expect(() => parseOccupancy(occupancy('2024-03'), '2024-02')).toThrow();
    const zero = occupancy();

    zero.dates[0] = {
      date: zero.from,
      occupiedRooms: 0,
      eligibleRooms: 0,
      rate: 0
    };
    expect(() => parseOccupancy(zero, '2024-02')).toThrow();
  });
  it('client rejects non-OK responses and sends only same-origin credentials', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 403 })));

    vi.stubGlobal('fetch', fetchMock);
    await expect(loadOccupancy('2024-02', new AbortController().signal)).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/analytics/occupancy?month=2024-02',
      expect.objectContaining({
        credentials: 'same-origin',
        cache: 'no-store'
      })
    );
  });
});
describe('Analytics heatmap UI', () => {
  it('labels every date and exposes the selected room-night counts', async () => {
    setup();
    const calendar = await screen.findByRole('group', { name: 'Occupancy calendar 2024-02' });

    await waitFor(() => expect(within(calendar).getAllByRole('button')).toHaveLength(29));
    const days = within(calendar).getAllByRole('button');

    expect(days[0]).toHaveAccessibleName(expect.stringContaining('2 occupied rooms, 10 eligible rooms'));
    fireEvent.focus(days[0]);
    expect(days[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('navigates months without showing obsolete results', async () => {
    let resolveOld!: (response: Response) => void;

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<Response>(resolve => {
              resolveOld = resolve;
            })
        )
        .mockImplementation(() => Promise.resolve(response(occupancy('2024-03'))))
    );
    render(<OccupancyCalendar initialMonth="2024-02" />);
    fireEvent.click(screen.getByText('Legend', { selector: 'summary' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next occupancy month' }));
    await screen.findByRole('group', { name: 'Occupancy calendar 2024-03' });
    await act(async () => resolveOld(response(occupancy())));
    expect(screen.queryByRole('group', { name: 'Occupancy calendar 2024-02' })).not.toBeInTheDocument();
  });
  it('keeps unavailable data distinct from zero and retries the failed request', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockImplementation(() => Promise.resolve(response(occupancy())));

    vi.stubGlobal('fetch', fetchMock);
    render(<OccupancyCalendar initialMonth="2024-02" />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: /2024-02-01:/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry occupancy' }));
    expect(await screen.findByRole('button', { name: /2024-02-01:/ })).toBeVisible();
  });
  it.each([401, 403])('preserves access handling for status %s', async status => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status })))
    );
    render(<OccupancyCalendar initialMonth="2024-02" />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Retry occupancy' })).not.toBeInTheDocument();
    if (status === 401) expect(screen.getByRole('link', { name: 'Sign in' })).toBeVisible();
    else expect(screen.getByRole('alert')).toHaveTextContent('permission');
  });
  it('aborts pending requests on unmount', async () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));

    vi.stubGlobal('fetch', fetchMock);
    const view = render(<OccupancyCalendar initialMonth="2024-02" />);

    view.unmount();
    await waitFor(() => expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true));
  });
});
