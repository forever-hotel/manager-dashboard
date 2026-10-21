import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TaskLimitSettings from '@/components/TaskLimitSettings';
import { taskLimitFixture } from './task-limit-fixture';
let data: ReturnType<typeof taskLimitFixture>,
  fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  data = taskLimitFixture();
  fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') {
      const body = JSON.parse(String(options.body)) as {
        limit: number;
        version: number;
      };
      data = { ...data, limit: body.limit, version: body.version + 1 };
    }
    return new Response(JSON.stringify(data));
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('DDP-045 task-limit settings', () => {
  it('rejects fractional drafts before sending an update', async () => {
    render(<TaskLimitSettings />);
    const input = await screen.findByLabelText(
      'Maximum active tasks per worker',
    );
    await waitFor(() => expect(input).toHaveValue(3));
    fireEvent.change(input, { target: { value: '2.5' } });
    fireEvent.submit(input.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'whole number from 1 to 10',
    );
    expect(
      fetchMock.mock.calls.filter(([, options]) => options?.method === 'PATCH'),
    ).toHaveLength(0);
  });
  it('loads default3 as pending, saves a versioned request and waits for WKMS confirmation', async () => {
    render(<TaskLimitSettings />);
    const input = await screen.findByLabelText(
      'Maximum active tasks per worker',
    );
    await waitFor(() => expect(input).toHaveValue(3));
    expect(
      screen.getByText('WKMS-confirmed limit: Not confirmed'),
    ).toBeVisible();
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task limit' }));
    expect(
      await screen.findByText(/Saved. Waiting for WKMS confirmation/),
    ).toBeVisible();
    expect(screen.getByText('Requested limit: 2 (version 1)')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/settings/task-limit',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ limit: 2, version: 0 }),
      }),
    );
    data = {
      ...data,
      effectiveLimit: 2,
      effectiveVersion: 1,
      confirmedAt: data.updatedAt,
      status: 'EFFECTIVE',
    };
    fireEvent.click(
      screen.getByRole('button', { name: 'Reload current version' }),
    );
    expect(
      await screen.findByText('Effective — confirmed by WKMS.'),
    ).toBeVisible();
  });
  it('preserves a conflicting draft, reloads the current version and does not silently retry', async () => {
    const original = fetchMock.getMockImplementation() as (
      url: string,
      options?: RequestInit,
    ) => Promise<Response>;
    fetchMock.mockImplementation((url: string, options?: RequestInit) =>
      options?.method === 'PATCH'
        ? Promise.resolve(new Response('{}', { status: 409 }))
        : original(url, options),
    );
    render(<TaskLimitSettings />);
    const input = await screen.findByLabelText(
      'Maximum active tasks per worker',
    );
    await waitFor(() => expect(input).toHaveValue(3));
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save task limit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Policy changed',
    );
    expect(input).toHaveValue(1);
    data = { ...data, limit: 5, version: 1 };
    fireEvent.click(
      screen.getByRole('button', { name: 'Reload current version' }),
    );
    expect(
      await screen.findByText('Requested limit: 5 (version 1)'),
    ).toBeVisible();
    expect(input).toHaveValue(1);
    expect(
      fetchMock.mock.calls.filter(([, o]) => o?.method === 'PATCH'),
    ).toHaveLength(1);
  });
  it('shows source failure without fabricating an effective default or losing edits', async () => {
    render(<TaskLimitSettings />);
    const input = await screen.findByLabelText(
      'Maximum active tasks per worker',
    );
    await waitFor(() => expect(input).toHaveValue(3));
    fireEvent.change(input, { target: { value: '4' } });
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Reload current version' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Settings are unavailable',
    );
    expect(input).toHaveValue(4);
    expect(
      screen.getByText('WKMS-confirmed limit: Not confirmed'),
    ).toBeVisible();
  });
  it.each([401, 403])(
    'clears policy and disallows editing after authorization failure %s',
    async (status) => {
      fetchMock.mockResolvedValue(new Response('{}', { status }));
      render(<TaskLimitSettings />);
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'manager access',
      );
      expect(
        screen.queryByLabelText('Maximum active tasks per worker'),
      ).not.toBeInTheDocument();
    },
  );
  it('polls for acknowledgements without overwriting a dirty draft and cleans up on unmount', async () => {
    vi.useFakeTimers();
    const view = render(<TaskLimitSettings />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const input = screen.getByLabelText('Maximum active tasks per worker');
    fireEvent.change(input, { target: { value: '7' } });
    data = { ...data, limit: 4, version: 1 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(input).toHaveValue(7);
    expect(screen.getByText('Requested limit: 4 (version 1)')).toBeVisible();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
