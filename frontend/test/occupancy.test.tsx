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
  const fetchMock = vi.fn().mockResolvedValue(response(data));
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
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 403 }));
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
describe('DDP-016 calendar UI', () => {
  it('TC-MAD-016-AC1/AC2: labels every day and exposes counts on focus and in a table', async () => {
    setup();
    expect(screen.getByRole('status')).toHaveTextContent('Loading occupancy');
    const calendar = await screen.findByRole('group', {
      name: 'Occupancy calendar 2024-02'
    });
    const days = within(calendar).getAllByRole('button');
    expect(days).toHaveLength(29);
    occupancy().dates.forEach((day, index) =>
      expect(days[index]).toHaveAccessibleName(expect.stringContaining(`${demand(day.rate)} demand`))
    );
    expect(
      within(screen.getByRole('group', { name: 'Demand scale legend' })).getByText('High: 70% to 100%')
    ).toBeVisible();
    fireEvent.focus(days[0]);
    expect(days[0]).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByText('2024-02-01: 2 occupied rooms, 10 eligible rooms; 20.0% occupancy; Low demand.')
    ).toBeVisible();
    fireEvent.click(days[1]);
    expect(days[1]).toHaveAttribute('aria-pressed', 'true');
    const table = screen.getByRole('table', {
      name: 'Daily occupancy data for 2024-02'
    });
    expect(within(table).getAllByRole('row')).toHaveLength(30);
    expect(days[3]).toHaveAccessibleName(expect.stringContaining('occupancy unknown (no eligible capacity)'));
    expect(calendar.children[10]).toBe(days[0]);
  });
  it('TC-MAD-016-AC3: navigates leap February and does not display stale results', async () => {
    let resolveOld!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockReturnValueOnce(
          new Promise<Response>(resolve => {
            resolveOld = resolve;
          })
        )
        .mockResolvedValue(response(occupancy('2024-03')))
    );
    render(<OccupancyCalendar initialMonth="2024-02" />);
    fireEvent.click(screen.getByRole('button', { name: 'Next occupancy month' }));
    await screen.findByRole('group', { name: 'Occupancy calendar 2024-03' });
    await act(async () => resolveOld(response(occupancy())));
    expect(screen.queryByRole('group', { name: 'Occupancy calendar 2024-02' })).not.toBeInTheDocument();
  });
  it('TC-MAD-016-AC3: distinguishes empty, unknown and known zero occupancy', async () => {
    const data = occupancy();
    data.dates = [];
    const fetchMock = setup(data);
    await screen.findByText('No occupancy data is available for this month.');
    const unknown = occupancy('2024-01');
    unknown.dates.forEach(day => Object.assign(day, { occupiedRooms: 0, eligibleRooms: 0, rate: null }));
    fetchMock.mockResolvedValue(response(unknown));
    fireEvent.click(screen.getByRole('button', { name: 'Previous occupancy month' }));
    await screen.findByText('Occupancy is unknown: no eligible room capacity is available this month.');
    const zero = occupancy();
    zero.dates.forEach(day => Object.assign(day, { occupiedRooms: 0, eligibleRooms: 10, rate: 0 }));
    fetchMock.mockResolvedValue(response(zero));
    fireEvent.click(screen.getByRole('button', { name: 'Next occupancy month' }));
    await screen.findByText('No occupied rooms this month. Known occupancy is 0%.');
  });
  it('TC-MAD-016-AC3: retries failures without presenting fabricated zero values', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(response(occupancy()));
    vi.stubGlobal('fetch', fetchMock);
    render(<OccupancyCalendar initialMonth="2024-02" />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry occupancy' }));
    await screen.findByRole('table');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403])('shows the appropriate access error for %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    render(<OccupancyCalendar initialMonth="2024-02" />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Retry occupancy' })).not.toBeInTheDocument();
    if (status === 401) expect(screen.getByRole('link', { name: 'Sign in' })).toBeVisible();
    else expect(screen.getByRole('alert')).toHaveTextContent('permission');
  });
  it('aborts requests on unmount', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) =>
            options.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          )
      );
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<OccupancyCalendar initialMonth="2024-02" />);
    view.unmount();
    await waitFor(() => expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true));
  });
});
