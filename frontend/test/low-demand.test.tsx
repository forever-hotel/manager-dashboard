import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LowDemandAlerts from '@/components/LowDemandAlerts';
import { lowDemandSchema, promotionDates } from '@/lib/low-demand';
import { lowDemand } from './low-demand-fixture';
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
describe('DDP-057 low-demand suggestions', () => {
  it('TC-MAD-057-AC1: displays forecast dates, expected occupancy, threshold and a non-mutating promotion link', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(lowDemand()));
    vi.stubGlobal('fetch', fetcher);
    render(<LowDemandAlerts />);
    const action = await screen.findByRole('link', {
      name: 'Create Promotion for 2028-02-29',
    });
    expect(action).toHaveAttribute(
      'href',
      '/promotions?lowDemandDate=2028-02-29',
    );
    expect(screen.getByText(/Expected occupancy: 20.0%/)).toBeVisible();
    expect(screen.getByText(/strictly below 40%/)).toBeVisible();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/analytics/low-booking-alerts',
      expect.objectContaining({
        cache: 'no-store',
        credentials: 'same-origin',
      }),
    );
  });
  it('TC-MAD-057-AC3: distinguishes no alerts from unassessable dates', async () => {
    const data = lowDemand();
    data.alerts = [];
    data.unavailableDates = [
      {
        date: '2028-02-29',
        occupiedRooms: 0,
        eligibleRooms: 0,
        rate: null,
        reason: 'ZERO_ELIGIBLE_ROOMS',
      },
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)));
    render(<LowDemandAlerts />);
    expect(
      await screen.findByText(/No low-demand alerts for dates with available/),
    ).toBeVisible();
    expect(
      screen.getByText(/These dates cannot be assessed as healthy demand/),
    ).toBeVisible();
    expect(
      screen.queryByRole('link', { name: /Create Promotion/ }),
    ).not.toBeInTheDocument();
  });
  it('TC-MAD-057-AC3: failed loading is unknown demand and retry can recover', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response(lowDemand()));
    vi.stubGlobal('fetch', fetcher);
    render(<LowDemandAlerts />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Demand is unknown',
    );
    expect(screen.queryByText(/No low-demand alerts/)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry low-demand alerts' }),
    );
    await screen.findByRole('link', { name: /Create Promotion/ });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it.each([401, 403])(
    'shows authorization failure %s without presenting healthy demand',
    async (status) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, status)));
      render(<LowDemandAlerts />);
      await screen.findByRole('alert');
      expect(
        screen.queryByText(/No low-demand alerts/),
      ).not.toBeInTheDocument();
      if (status === 401)
        expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
          'href',
          '/login',
        );
    },
  );
  it('aborts the request on unmount', async () => {
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<LowDemandAlerts />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
  it('TC-MAD-057-AC2: prefills half-open Colombo dates across leap day and year boundaries', () => {
    expect(promotionDates('2028-02-29')).toEqual({
      validFrom: '2028-02-29T00:00',
      validUntil: '2028-03-01T00:00',
    });
    expect(promotionDates('2028-12-31')?.validUntil).toBe('2029-01-01T00:00');
    for (const date of [
      undefined,
      '2027-02-29',
      'not-a-date',
      '0000-01-01',
      '9999-12-31',
    ])
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
        unavailableDates: [
          { ...lowDemand().alerts[0], reason: 'ZERO_ELIGIBLE_ROOMS' },
        ],
      },
    ])
      expect(
        lowDemandSchema.safeParse({ ...lowDemand(), ...change }).success,
      ).toBe(false);
  });
});
