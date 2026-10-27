vi.mock('@/components/useRealtimeRefresh', () => ({ useRealtimeRefresh: () => undefined }));
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LowDemandAlerts from '@/components/LowDemandAlerts';
import { lowDemandSchema, promotionDates } from '@/lib/low-demand';
import { lowDemand } from './low-demand-fixture';
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
describe('DDP-057 low-demand suggestions', () => {
  it('renders a promotion suggestion directly from the low-demand response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(lowDemand())));
    render(<LowDemandAlerts />);
    const link = await screen.findByRole('link', { name: /consider creating a promotion/ });
    expect(link).toHaveAttribute('href', '/promotions?lowDemandDate=' + lowDemand().alerts[0].date);
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  });
  it('keeps unavailable capacity distinct from healthy demand', async () => {
    const data = lowDemand();
    data.alerts = [];
    data.unavailableDates = [
      { date: '2028-02-21', occupiedRooms: 0, eligibleRooms: 0, rate: null, reason: 'ZERO_ELIGIBLE_ROOMS' }
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)));
    render(<LowDemandAlerts />);
    expect(await screen.findByText(/Some occupancy dates cannot be assessed/)).toBeVisible();
  });
  it('retries outages without claiming demand is healthy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response(lowDemand()))
    );
    render(<LowDemandAlerts />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Demand is unknown');
    fireEvent.click(screen.getByRole('button', { name: 'Retry low-demand alerts' }));
    expect(await screen.findByRole('link', { name: /consider creating a promotion/ })).toBeVisible();
  });
  it.each([401, 403])('preserves authorization handling for %s', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, status)));
    render(<LowDemandAlerts />);
    await screen.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Retry low-demand alerts' })).not.toBeInTheDocument();
    if (status === 401) expect(screen.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });
  it('cancels work on unmount', async () => {
    const fetcher = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<LowDemandAlerts />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('TC-MAD-057-AC2: prefills half-open Colombo dates across leap day and year boundaries', () => {
    expect(promotionDates('2028-02-29')).toEqual({
      validFrom: '2028-02-29T00:00',
      validUntil: '2028-03-01T00:00'
    });
    expect(promotionDates('2028-12-31')?.validUntil).toBe('2029-01-01T00:00');
    for (const date of [undefined, '2027-02-29', 'not-a-date', '0000-01-01', '9999-12-31'])
      expect(promotionDates(date)).toBeUndefined();
  });
  it('rejects malformed, duplicate, out-of-range and non-low occupancy responses', () => {
    for (const change of [
      { to: '2028-03-05' },
      { alerts: [lowDemand().alerts[0], lowDemand().alerts[0]] },
      { threshold: 0.2 },
      { alerts: [{ ...lowDemand().alerts[0], date: '2028-03-05' }] },
      { alerts: [{ ...lowDemand().alerts[0], rate: null }] },
      {
        unavailableDates: [{ ...lowDemand().alerts[0], reason: 'ZERO_ELIGIBLE_ROOMS' }]
      }
    ])
      expect(lowDemandSchema.safeParse({ ...lowDemand(), ...change }).success).toBe(false);
  });
});
