import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import ReportDownload from '@/components/ReportDownload';
import { readReport, reportQuery, reportFilename, MAX_DOWNLOAD_BYTES } from '@/lib/reports';
import { reportResponse, csv } from './report-fixture';
let fetchMock: ReturnType<typeof vi.fn>;
let click: ReturnType<typeof vi.spyOn>;
const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
beforeEach(() => {
  fetchMock = vi.fn(async () => reportResponse());
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:report')
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn()
  });
  click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
  else Reflect.deleteProperty(URL, 'createObjectURL');
  if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
  else Reflect.deleteProperty(URL, 'revokeObjectURL');
});
describe('DDP-031 report downloads', () => {
  it('AC1: sends current filters, names the file and revokes temporary URLs', async () => {
    const view = render(<ReportDownload type="bookings" filters={{ period: 'month' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/reports/bookings?format=csv&period=month',
      expect.objectContaining({ credentials: 'same-origin' })
    );
    const anchor = click.mock.contexts[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('bookings-2026-10-21.csv');
    expect(anchor.href).toBe('blob:report');
    expect(document.querySelector('a[download]')).toBeNull();
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:report');
  });
  it('AC2: prevents duplicate work while slow, reports errors and retries the chosen format', async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          finish = resolve;
        })
    );
    render(<ReportDownload type="bookings" />);
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(screen.getByRole('status')).toHaveTextContent('Preparing PDF');
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => finish(new Response('{}', { status: 503 })));
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable');
    expect(click).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(reportResponse('pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry download' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
  });
  it('does not download corrupt responses or obsolete in-flight filters', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('<html>error</html>', {
        headers: {
          'Content-Type': 'text/html',
          'Content-Disposition': 'attachment; filename="bookings-2026-10-21.csv"'
        }
      })
    );
    const view = render(<ReportDownload type="bookings" />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await screen.findByRole('alert');
    expect(click).not.toHaveBeenCalled();
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          finish = resolve;
        })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry download' }));
    view.rerender(<ReportDownload type="bookings" filters={{ period: 'month' }} />);
    await act(async () => finish(reportResponse()));
    expect(click).not.toHaveBeenCalled();
  });
  it.each([401, 403, 422])('shows actionable feedback for status %s', async status => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status }));
    render(<ReportDownload type="bookings" />);
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      status === 401 ? 'sign in' : status === 403 ? 'Manager' : 'too large'
    );
    expect(click).not.toHaveBeenCalled();
  });
  it('validates filter contracts and binary size/completeness before download', async () => {
    for (const [type, query] of [
      ['bad', 'format=csv'],
      ['bookings', 'format=csv&format=pdf'],
      ['occupancy', 'format=pdf&from=2020-01-01&to=2026-10-21'],
      ['occupancy', 'format=pdf&from=2026-10-21&to=2026-10-01']
    ])
      expect(() => reportQuery(type, new URLSearchParams(query))).toThrow();
    expect(() => reportFilename('bookings', 'csv', 'attachment; filename="revenue-2026-10-21.csv"')).toThrow();
    expect(() => reportFilename('bookings', 'pdf', 'attachment; filename="bookings-2026-10-21.csv"')).toThrow();
    await expect(
      readReport(
        new Response('broken', {
          headers: { 'Content-Type': 'application/pdf' }
        }),
        'pdf'
      )
    ).rejects.toThrow();
    await expect(
      readReport(
        new Response(csv, {
          headers: { 'Content-Type': 'text/csv', 'Content-Length': '1' }
        }),
        'csv'
      )
    ).rejects.toThrow();
    await expect(
      readReport(
        new Response(csv, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Length': String(MAX_DOWNLOAD_BYTES + 1)
          }
        }),
        'csv'
      )
    ).rejects.toThrow();
    await expect(
      readReport(
        new Response(new Uint8Array(MAX_DOWNLOAD_BYTES + 1), {
          headers: { 'Content-Type': 'text/csv' }
        }),
        'csv'
      )
    ).rejects.toThrow();
    await expect(readReport(new Response(null, { headers: { 'Content-Type': 'text/csv' } }), 'csv')).rejects.toThrow();
  });
});
