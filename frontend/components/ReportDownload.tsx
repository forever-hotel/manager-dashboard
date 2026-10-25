'use client';
import { useEffect, useRef, useState } from 'react';
import {
  reportQuery,
  reportFilename,
  readReport,
  exportError,
  type ReportType,
  type ReportFilters
} from '@/lib/reports';
export default function ReportDownload({
  type,
  filters = {},
  disabled = false
}: {
  type: ReportType;
  filters?: ReportFilters;
  disabled?: boolean;
}) {
  const key =
    type +
    '?' +
    new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined) as [string, string][]
    ).toString();
  const [state, setState] = useState<{
    key: string;
    busy?: string;
    error?: string;
    retry?: 'csv' | 'pdf';
  }>({ key });
  const request = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = urls.current;
    return () => {
      request.current?.abort();
      for (const [url, timer] of pending) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      pending.clear();
    };
  }, [key]);
  async function download(format: 'csv' | 'pdf') {
    if (lock.current || disabled) return;
    lock.current = true;
    const controller = new AbortController();
    request.current = controller;
    setState({ key, busy: format });
    let response: Response | undefined;
    try {
      const query = reportQuery(
        type,
        new URLSearchParams([
          ...(Object.entries(filters).filter(([, value]) => value !== undefined) as [string, string][]),
          ['format', format]
        ])
      );
      response = await fetch('/api/reports/' + type + '?' + query.toString(), {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(exportError(response.status));
      const filename = reportFilename(type, format, response.headers.get('content-disposition'));
      const bytes = await readReport(response, format);
      if (controller.signal.aborted) return;
      const blob = new Blob([bytes], {
        type: format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8'
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        const timer = setTimeout(() => {
          URL.revokeObjectURL(url);
          urls.current.delete(url);
        }, 1000);
        urls.current.set(url, timer);
      }
      setState({ key });
    } catch (error) {
      if (!controller.signal.aborted)
        setState({
          key,
          error:
            error instanceof Error && Object.values([400, 401, 403, 422, 503].map(exportError)).includes(error.message)
              ? error.message
              : 'The report could not be downloaded. Please retry.',
          retry: format
        });
    } finally {
      await response?.body?.cancel().catch(() => undefined);
      lock.current = false;
    }
  }
  const active = state.key === key ? state : undefined;
  return (
    <div className="mt-3" role="group" aria-label={type + ' report downloads'} aria-busy={!!active?.busy}>
      <div className="flex gap-3">
        {(['pdf', 'csv'] as const).map(format => (
          <button
            key={format}
            type="button"
            disabled={disabled || !!active?.busy}
            onClick={() => void download(format)}
            className={
              'font-normal text-[10.5px] text-black rounded-md px-4 py-2 ' +
              (format === 'pdf' ? 'bg-gray-100' : 'border border-gray-200')
            }
          >
            Export {format.toUpperCase()}
          </button>
        ))}
      </div>
      {active?.busy && (
        <p role="status" className="text-[10.5px] text-black/60 mt-2">
          Preparing {active.busy.toUpperCase()} report...
        </p>
      )}
      {active?.error && (
        <p role="alert" className="text-[10.5px] text-black mt-2">
          {active.error}{' '}
          <button type="button" className="underline" onClick={() => void download(active.retry!)}>
            Retry download
          </button>
        </p>
      )}
    </div>
  );
}
