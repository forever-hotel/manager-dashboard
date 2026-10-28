import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PromotionsDashboard from '@/components/PromotionsDashboard';
import {
  createSchema,
  formFrom,
  formPayload,
  promotionRequest,
  promotionSchema,
  publicationLabel
} from '@/lib/promotions';
import { page, promotion, room } from './promotions-fixture';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function setup(items = [promotion()]) {
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (init?.method && init.method !== 'GET') return json(promotion({ version: 1 }));
    if (path.includes('/room-types')) return json(page([room]));
    if (path.includes('?')) return json(page(items));
    return json(items[0]);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function ready() {
  await screen.findByRole('button', { name: 'Actions for OFFER26' });
}
function fill() {
  for (const [label, value] of [
    ['Promo code', 'new26'],
    ['Discount value', '25'],
    ['Valid from', '2026-10-01T00:00'],
    ['Valid until', '2099-11-01T00:00'],
    ['Max redemptions', '100']
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByLabelText('Applicable room types'));
  fireEvent.click(screen.getByRole('checkbox', { name: /Suite/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
}
const mutations = (fetcher: ReturnType<typeof setup>) =>
  fetcher.mock.calls.filter(([, init]) => init?.method !== 'GET');
describe('DDP-020 promotion management', () => {
  it('TC-MAD-057-AC2: opens the existing create form with only dates prefilled and makes no mutation', async () => {
    const fetcher = setup();
    render(<PromotionsDashboard initialDate="2028-02-29" />);
    await ready();
    expect(screen.getByLabelText('Valid from')).toHaveValue('2028-02-29T00:00');
    expect(screen.getByLabelText('Valid until')).toHaveValue('2028-03-01T00:00');
    expect(screen.getByLabelText('Promo code')).toHaveValue('');
    expect(mutations(fetcher)).toHaveLength(0);
  });
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T00:00:00Z'));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it.each(['Save & activate', 'Save as draft'])(
    'TC-MAD-020-AC1: creates via %s with every field and hotel-time boundaries',
    async button => {
      const fetcher = setup();
      render(<PromotionsDashboard />);
      await ready();
      fill();
      fireEvent.click(screen.getByRole('button', { name: button }));
      await screen.findByText(/Saved OFFER26/);
      const [url, init] = mutations(fetcher)[0];
      expect(url).toBe('/api/promotions');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        code: 'NEW26',
        discountType: 'PERCENTAGE',
        discountValue: 25,
        validFrom: '2026-10-01T00:00:00+05:30',
        validUntil: '2099-11-01T00:00:00+05:30',
        maxRedemptions: 100,
        roomTypeIds: [room.id],
        status: button === 'Save as draft' ? 'INACTIVE' : 'ACTIVE'
      });
      expect(screen.getByLabelText('Promo code')).toHaveValue('');
    }
  );
  it('TC-MAD-020-AC2: validates fields without losing values or sending writes', async () => {
    const fetcher = setup();
    render(<PromotionsDashboard />);
    await ready();
    fill();
    fireEvent.change(screen.getByLabelText('Discount value'), {
      target: { value: '101' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save & activate' }));
    expect(screen.getByRole('alert')).toHaveTextContent('between 1 and 100');
    expect(screen.getByLabelText('Promo code')).toHaveValue('new26');
    expect(mutations(fetcher)).toHaveLength(0);
  });
  it('TC-MAD-020-AC2: reloads a conflicting version and preserves unsaved input', async () => {
    const fetcher = setup();
    render(<PromotionsDashboard />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for OFFER26' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit promotion' }));
    await screen.findByRole('button', { name: 'Save changes' });
    fireEvent.change(screen.getByLabelText('Promo code'), {
      target: { value: 'MYEDIT' }
    });
    fetcher.mockResolvedValueOnce(json({}, 409));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Conflict');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fetcher.mockResolvedValueOnce(json(promotion({ version: 7, code: 'OTHEREDIT' })));
    fireEvent.click(screen.getByRole('button', { name: /Reload latest version/ }));
    await screen.findByText(/Latest version 7 loaded/);
    expect(screen.getByLabelText('Promo code')).toHaveValue('MYEDIT');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText(/Saved OFFER26/);
    const [, init] = mutations(fetcher).at(-1)!;
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      version: 7,
      code: 'MYEDIT'
    });
  });
  it.each(['Activate', 'Deactivate', 'Delete'])(
    'TC-MAD-020-AC1: %s sends the version and confirms destructive changes',
    async action => {
      const fetcher = setup([promotion({ status: action === 'Activate' ? 'INACTIVE' : 'ACTIVE' })]);
      render(<PromotionsDashboard />);
      await ready();
      fireEvent.click(screen.getByRole('button', { name: 'Actions for OFFER26' }));
      fireEvent.click(screen.getByRole('button', { name: action + ' promotion' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm ' + action.toLowerCase() }));
      await screen.findByText(/Saved OFFER26:/);
      const [url, init] = mutations(fetcher)[0];
      expect(url).toBe('/api/promotions/' + promotion().id + (action === 'Delete' ? '' : '/' + action.toLowerCase()));
      expect(init?.method).toBe(action === 'Delete' ? 'DELETE' : 'POST');
      expect(JSON.parse(String(init?.body))).toEqual({ version: 0 });
      expect(window.confirm).not.toHaveBeenCalled();
      expect(screen.queryByRole('region', { name: 'Actions for OFFER26' })).not.toBeInTheDocument();
    }
  );
  it('cancelling deletion leaves records and history untouched', async () => {
    const fetcher = setup();
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<PromotionsDashboard />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for OFFER26' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete promotion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel action' }));
    expect(mutations(fetcher)).toHaveLength(0);
    expect(screen.getByText('OFFER26')).toBeVisible();
  });
  it('defaults to active and switches to inactive for reactivation without browser dialogs', async () => {
    const fetcher = setup();
    render(<PromotionsDashboard />);
    await ready();
    expect(fetcher).toHaveBeenCalledWith('/api/promotions?page=1&pageSize=20&view=active', expect.anything());
    expect(screen.queryByText('Promotion validation and units')).not.toBeInTheDocument();
    expect(screen.queryByText('Refresh promotions')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Show promotions'), { target: { value: 'inactive' } });
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith('/api/promotions?page=1&pageSize=20&view=inactive', expect.anything())
    );
  });
  it.each(['PENDING', 'FAILED', 'NO_PENDING_WORK'] as const)(
    'TC-MAD-020-AC3: %s never claims website availability',
    async status => {
      setup([promotion({ publicationStatus: status })]);
      render(<PromotionsDashboard />);
      await ready();
      expect(screen.getByText(publicationLabel(status))).toBeVisible();
      expect(screen.queryByText(/published successfully|live on website/i)).not.toBeInTheDocument();
    }
  );
  it.each([400, 401, 403, 404, 503])('preserves form after save failure %s', async status => {
    const fetcher = setup();
    render(<PromotionsDashboard />);
    await ready();
    fill();
    fetcher.mockResolvedValueOnce(json({}, status));
    fireEvent.click(screen.getByRole('button', { name: 'Save & activate' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Promo code')).toHaveValue('new26');
  });
  it('handles loading, empty state and retryable list failure', async () => {
    const fetcher = setup([]);
    fetcher.mockRejectedValueOnce(new Error('offline'));
    render(<PromotionsDashboard />);
    expect(screen.getByText('Loading promotions...')).toBeVisible();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry promotions' }));
    expect(await screen.findByText('No unexpired promotions in this view.')).toBeVisible();
  });
  it('displays exact fixed amounts, redemptions and room names', async () => {
    setup([promotion({ discountType: 'FIXED_AMOUNT', discountValue: 12345 })]);
    render(<PromotionsDashboard />);
    await ready();
    const table = within(screen.getByRole('table'));
    expect(table.getByText('LKR 123.45')).toBeVisible();
    expect(table.getByText('5 / 100')).toBeVisible();
    expect(table.getByText('Suite')).toBeVisible();
  });
  it('paginates and prevents duplicate submissions while saving', async () => {
    const fetcher = setup();
    fetcher.mockResolvedValueOnce(json(page([promotion()], 21)));
    render(<PromotionsDashboard />);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith('/api/promotions?page=2&pageSize=20&view=active', expect.anything())
    );
    await ready();
    fill();
    let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          finish = resolve;
        })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save & activate' }));
    const saving = screen.getByRole('button', { name: 'Saving...' });
    expect(saving).toBeDisabled();
    fireEvent.click(saving);
    expect(mutations(fetcher)).toHaveLength(1);
    finish(json(promotion()));
    await screen.findByText(/Saved OFFER26/);
  });
  it('round-trips hotel dates and rejects invalid boundaries, currency and duplicate selections', async () => {
    const p = promotion();
    const payload = formPayload(formFrom(p));
    expect(Date.parse(payload.validFrom)).toBe(Date.parse(p.validFrom));
    expect(createSchema.safeParse(payload).success).toBe(true);
    for (const change of [
      { discountValue: 1.5 },
      { validUntil: payload.validFrom },
      { roomTypeIds: [room.id, room.id] },
      { maxRedemptions: 0 },
      { code: 'bad code' }
    ])
      expect(createSchema.safeParse({ ...payload, ...change }).success).toBe(false);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({})));
    await expect(promotionRequest('', promotionSchema)).rejects.toThrow();
  });
});
