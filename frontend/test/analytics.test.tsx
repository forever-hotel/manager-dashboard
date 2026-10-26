import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
vi.mock('@/components/LowDemandAlerts', () => ({ default: () => null }));
vi.mock('@/components/OccupancyCalendar', () => ({ default: () => null }));
import { overview } from './analytics-fixture';
import { loadAnalytics, money, overviewSchema, percentage } from '@/lib/analytics';
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown) => new Response(JSON.stringify(data));
describe('DDP-015 booking and revenue analytics', () => {
  it('loads live summary cards and recent bookings without the superseded controls', async () => {
    const data = overview();
    data.recentBookings = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        guestName: 'A. Perera',
        roomType: 'Suite',
        checkIn: '2026-10-12',
        checkOut: '2026-10-14',
        amountMinor: 4200000,
        source: 'WEBSITE',
        status: 'CONFIRMED'
      }
    ];
    const fetchMock = vi.fn().mockResolvedValue(response(data));
    vi.stubGlobal('fetch', fetchMock);
    render(<AnalyticsDashboard />);
    expect(await screen.findByText('LKR 200.01')).toBeVisible();
    expect(screen.getByText('50.0%')).toBeVisible();
    expect(screen.getByText('2.4 nights')).toBeVisible();
    expect(screen.getByText('A. Perera')).toBeVisible();
    expect(screen.getByRole('img', { name: /Bar chart of daily bookings/ })).toBeVisible();
    expect(screen.queryByText('Reporting details and revenue export')).not.toBeInTheDocument();
    expect(screen.queryByText('Line chart')).not.toBeInTheDocument();
    fetchMock.mockResolvedValue(response(overview('day', 8)));
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    await waitFor(() => expect(screen.getByText('+100.01% vs last day')).toBeVisible());
  });
  it('keeps a 31-day month readable and compacts large revenue totals', async () => {
    const data = overview('month', 31);
    data.bookings.trend = Array.from({ length: 31 }, (_, i) => ({
      ...data.bookings.trend[0],
      date: '2026-10-' + String(i + 1).padStart(2, '0'),
      count: 1
    }));
    data.revenue.currentMinor = 138700000;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)));
    render(<AnalyticsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(await screen.findByText('LKR 1.39M')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Daily bookings chart' })).toBeVisible();
    expect(document.querySelector('.booking-bars-month')).toHaveStyle({ minWidth: '360px' });
  });
  it('TC-MAD-015-AC2/AC3: shows zero totals, N/A and the empty state without treating them as unavailable', async () => {
    const data = overview('week', 0);
    data.revenue = {
      ...data.revenue,
      currentMinor: 0,
      previousMinor: 0,
      percentageChange: null,
      percentageUnavailableReason: 'PREVIOUS_REVENUE_ZERO'
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)));
    render(<AnalyticsDashboard />);
    expect(await screen.findByText('N/A vs last week')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('No eligible bookings');
    expect(screen.getByText('LKR 0.00')).toBeVisible();
    expect(screen.getByRole('table')).toBeVisible();
  });
  it('TC-MAD-015-AC3: retries failure and discards obsolete responses even when transport ignores cancellation', async () => {
    let resolveOld!: (value: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>(resolve => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValueOnce(response(overview('month', 9)));
    vi.stubGlobal('fetch', fetchMock);
    render(<AnalyticsDashboard />);
    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    await screen.findByText('Total bookings (month)');
    await act(async () => {
      resolveOld(response(overview()));
    });
    expect(screen.queryByText('Total bookings (week)')).not.toBeInTheDocument();
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(response(overview('day')));
    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Total bookings (day)')).toBeVisible();
  });
  it.each([401, 403])('handles protected API status %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status })));
    render(<AnalyticsDashboard />);
    await screen.findByRole('alert');
    expect(
      screen.getByRole('link', {
        name: status === 401 ? 'Sign in' : 'Change password'
      })
    ).toBeVisible();
  });
  it('rejects mismatched or invalid data instead of displaying misleading metrics', async () => {
    const data = overview();
    data.revenue.period = 'day';
    expect(overviewSchema.safeParse(data).success).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(overview('month'))));
    await expect(loadAnalytics('day', new AbortController().signal)).rejects.toThrow('Mismatched');
    expect(percentage(null)).toBe('N/A');
    expect(percentage(-100)).toBe('-100.00%');
    expect(money(101)).toBe('LKR 1.01');
    expect(money(Number.MAX_SAFE_INTEGER)).toMatch(/\.91$/);
  });
  it('cancels work when unmounted', async () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(<AnalyticsDashboard />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal;
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
