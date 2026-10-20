import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ComplaintsDashboard from '@/components/ComplaintsDashboard';
import {
  COMPLAINT_CHANGED_EVENT,
  complaintPatchSchema,
  nextStatus,
} from '@/lib/complaints';
import { complaint, complaintPage } from './complaints-fixture';
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
function setup() {
  let current = complaint();
  const fetcher = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as {
          note: string;
          status: 'UNDER_REVIEW' | 'RESOLVED';
        };
        current = complaint({
          status: body.status,
          version: current.version + 1,
          history: [
            ...current.history,
            {
              version: current.version + 1,
              fromStatus: current.status,
              status: body.status,
              note: body.note,
              actorId: current.id,
              recordedAt: current.submittedAt,
            },
          ],
        });
        return json(current);
      }
      return json(
        String(url).includes('?') ? complaintPage([current]) : current,
      );
    },
  );
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
async function open() {
  fireEvent.click(
    await screen.findByRole('button', {
      name: 'View complaint ' + complaint().id,
    }),
  );
  await screen.findByLabelText('Internal note (manager only)');
}
const patches = (fetcher: ReturnType<typeof setup>) =>
  fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH');
describe('DDP-022 complaint register', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('TC-MAD-022-AC1: displays required fields, null worker and exact filters', async () => {
    const fetcher = setup();
    render(<ComplaintsDashboard />);
    await screen.findByRole('button', { name: /View complaint/ });
    const table = within(screen.getByRole('table'));
    expect(table.getByText('No worker referenced')).toBeVisible();
    expect(table.getByText(complaint().description)).toBeVisible();
    expect(table.getByText('Submitted')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'UNDER_REVIEW' },
    });
    fireEvent.change(screen.getByLabelText('Category (exact match)'), {
      target: { value: 'Room' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search complaints' }));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        '/api/complaints?page=1&pageSize=20&status=UNDER_REVIEW&category=Room',
        expect.anything(),
      ),
    );
  });
  it('TC-MAD-022-AC2: saves the current version, refreshes detail/register and announces count invalidation', async () => {
    const fetcher = setup();
    const listener = vi.fn();
    window.addEventListener(COMPLAINT_CHANGED_EVENT, listener);
    try {
      render(<ComplaintsDashboard />);
      await open();
      expect(
        screen.getByRole('region', { name: 'Complaint details' }),
      ).toHaveFocus();
      fireEvent.change(screen.getByLabelText('Internal note (manager only)'), {
        target: { value: 'Investigating privately' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: 'Save resolution update' }),
      );
      expect(await screen.findByText('Saved: Under review.')).toBeVisible();
      await screen.findByText('Investigating privately');
      expect(screen.getByLabelText('Internal note (manager only)')).toHaveValue(
        '',
      );
      expect(JSON.parse(String(patches(fetcher)[0][1]?.body))).toEqual({
        version: 0,
        status: 'UNDER_REVIEW',
        note: 'Investigating privately',
      });
      expect(
        within(screen.getByRole('table')).getByText('Under review'),
      ).toBeVisible();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(
        JSON.stringify((listener.mock.calls[0][0] as CustomEvent).detail),
      ).not.toContain('privately');
    } finally {
      window.removeEventListener(COMPLAINT_CHANGED_EVENT, listener);
    }
  });
  it.each([400, 401, 403, 404, 409, 503])(
    'TC-MAD-022-AC3: failed save %s preserves the editable note and never claims success',
    async (status) => {
      const fetcher = setup();
      render(<ComplaintsDashboard />);
      await open();
      fireEvent.change(screen.getByLabelText('Internal note (manager only)'), {
        target: { value: 'Keep my draft' },
      });
      fetcher.mockResolvedValueOnce(json({}, status));
      fireEvent.click(
        screen.getByRole('button', { name: 'Save resolution update' }),
      );
      await screen.findByRole('alert');
      expect(screen.getByLabelText('Internal note (manager only)')).toHaveValue(
        'Keep my draft',
      );
      expect(
        screen.getByLabelText('Internal note (manager only)'),
      ).toBeEnabled();
      expect(screen.queryByText(/^Saved:/)).not.toBeInTheDocument();
      if (status === 409) {
        expect(
          screen.getByRole('button', { name: 'Save resolution update' }),
        ).toBeDisabled();
        fetcher.mockResolvedValueOnce(
          json(complaint({ version: 1, status: 'UNDER_REVIEW' })),
        );
        fireEvent.click(
          screen.getByRole('button', {
            name: 'Reload latest version (keep note)',
          }),
        );
        await screen.findByText('Next status: Resolved');
        expect(
          screen.getByLabelText('Internal note (manager only)'),
        ).toHaveValue('Keep my draft');
        fireEvent.click(
          screen.getByRole('button', { name: 'Save resolution update' }),
        );
        await screen.findByText('Saved: Resolved.');
        expect(
          JSON.parse(String(patches(fetcher).at(-1)?.[1]?.body)),
        ).toMatchObject({ version: 1, status: 'RESOLVED' });
      }
    },
  );
  it('validates notes, prevents reopening and restores focus on close', async () => {
    const fetcher = setup();
    render(<ComplaintsDashboard />);
    await open();
    fireEvent.click(
      screen.getByRole('button', { name: 'Save resolution update' }),
    );
    await screen.findByText('Enter an internal note.');
    expect(patches(fetcher)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(
      screen.getByRole('button', { name: /View complaint/ }),
    ).toHaveFocus();
    fetcher.mockResolvedValueOnce(
      json(complaint({ status: 'RESOLVED', version: 2 })),
    );
    await open();
    expect(
      screen.getByRole('button', { name: 'Save resolution update' }),
    ).toBeDisabled();
  });
  it('handles empty/error/loading states and pagination', async () => {
    const fetcher = setup();
    fetcher.mockRejectedValueOnce(new Error('offline'));
    render(<ComplaintsDashboard />);
    expect(screen.getByText('Loading complaints...')).toBeVisible();
    await screen.findByRole('alert');
    fetcher.mockResolvedValueOnce(json(complaintPage([])));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh register' }));
    await screen.findByText('No complaints match these filters.');
    fetcher.mockResolvedValueOnce(json(complaintPage([complaint()], 21)));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh register' }));
    await screen.findByRole('button', { name: /View complaint/ });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        '/api/complaints?page=2&pageSize=20',
        expect.anything(),
      ),
    );
  });
  it('preserves a draft when dismissal is cancelled and renders notes as text', async () => {
    const fetcher = setup();
    render(<ComplaintsDashboard />);
    await screen.findByRole('button', { name: /View complaint/ });
    fetcher.mockResolvedValueOnce(
      json(
        complaint({
          history: [
            {
              version: 1,
              fromStatus: 'SUBMITTED',
              status: 'UNDER_REVIEW',
              note: '<script>private</script>',
              actorId: complaint().id,
              recordedAt: complaint().submittedAt,
            },
          ],
        }),
      ),
    );
    await open();
    expect(screen.getByText('<script>private</script>')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Internal note (manager only)'), {
      target: { value: 'Draft' },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.getByLabelText('Internal note (manager only)')).toHaveValue(
      'Draft',
    );
  });
  it('ignores late detail responses after another complaint is selected', async () => {
    const fetcher = setup();
    const other = complaint({
      id: '22222222-2222-4222-8222-222222222222',
      description: 'Second guest issue',
    });
    fetcher.mockResolvedValueOnce(json(complaintPage([complaint(), other])));
    render(<ComplaintsDashboard />);
    await screen.findByRole('button', { name: 'View complaint ' + other.id });
    let finish!: (value: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'View complaint ' + complaint().id }),
    );
    fetcher.mockResolvedValueOnce(json(other));
    fireEvent.click(
      screen.getByRole('button', { name: 'View complaint ' + other.id }),
    );
    await screen.findByLabelText('Internal note (manager only)');
    await act(async () => {
      finish(json(complaint()));
    });
    expect(
      within(
        screen.getByRole('region', { name: 'Complaint details' }),
      ).getByText('Second guest issue'),
    ).toBeVisible();
  });
  it('prevents duplicate writes and distinguishes a saved update from failed detail refresh', async () => {
    const fetcher = setup();
    render(<ComplaintsDashboard />);
    await open();
    fireEvent.change(screen.getByLabelText('Internal note (manager only)'), {
      target: { value: 'Keep this private' },
    });
    let finish!: (value: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Save resolution update' }),
    );
    const saving = screen.getByRole('button', { name: 'Saving...' });
    expect(saving).toBeDisabled();
    fireEvent.click(saving);
    expect(patches(fetcher)).toHaveLength(1);
    // The detail request is issued immediately after PATCH; list effect follows.
    fetcher.mockResolvedValueOnce(json({}, 503));
    await act(async () => {
      finish(json(complaint({ status: 'UNDER_REVIEW', version: 1 })));
    });
    expect(await screen.findByText('Saved: Under review.')).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Service unavailable',
    );
  });
  it('enforces transition and note boundaries', () => {
    expect(nextStatus('SUBMITTED')).toBe('UNDER_REVIEW');
    expect(nextStatus('UNDER_REVIEW')).toBe('RESOLVED');
    expect(nextStatus('RESOLVED')).toBeNull();
    for (const note of ['', ' ', 'x'.repeat(4001), '\u0000'])
      expect(
        complaintPatchSchema.safeParse({
          version: 0,
          status: 'UNDER_REVIEW',
          note,
        }).success,
      ).toBe(false);
  });
});
