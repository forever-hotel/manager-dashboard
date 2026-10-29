import { z } from 'zod';
export const reportTypes = [
  'bookings',
  'revenue',
  'worker-performance',
  'staff',
  'food-orders',
  'service-requests',
  'occupancy',
  'low-booking-alerts'
] as const;
export type ReportType = (typeof reportTypes)[number];
export type ReportFilters = {
  period?: string;
  workerId?: string;
  from?: string;
  to?: string;
  date?: string;
};
export const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
export function reportQuery(type: string, raw: URLSearchParams) {
  if (!reportTypes.includes(type as ReportType)) throw new Error('Unsupported report');
  const calendarDate = z.iso.date().refine(value => !value.startsWith('0000'));
  const fields =
    type === 'occupancy'
      ? { from: calendarDate, to: calendarDate }
      : type === 'low-booking-alerts'
        ? {}
        : {
            period: z.enum(['day', 'week', 'month']).default('day'),
            ...(['bookings', 'revenue', 'food-orders', 'service-requests'].includes(type)
              ? { date: calendarDate.optional() }
              : {}),
            ...(['staff', 'worker-performance'].includes(type) ? { workerId: z.uuid().optional() } : {})
          };
  if ([...raw.keys()].some(k => raw.getAll(k).length !== 1)) throw new Error('Repeated filters');
  const parsed = z
    .object({ format: z.enum(['csv', 'pdf']), ...fields })
    .strict()
    .parse(Object.fromEntries(raw));
  if ('from' in parsed && 'to' in parsed) {
    const days = (Date.parse(String(parsed.to)) - Date.parse(String(parsed.from))) / 86400000 + 1;
    if (days < 1 || days > 366) throw new Error('Use 1 to 366 dates');
  }
  return new URLSearchParams(parsed as Record<string, string>);
}
export function reportFilename(type: ReportType, format: string, disposition: string | null) {
  const match = disposition?.match(/^attachment; filename="([a-z-]+-\d{4}-\d{2}-\d{2}\.(?:csv|pdf))"$/);
  if (!match || !match[1].startsWith(type + '-') || !match[1].endsWith('.' + format))
    throw new Error('Invalid filename');
  return match[1];
}
export async function readReport(response: Response, format: string, type?: string) {
  if (
    (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !==
    (format === 'pdf' ? 'application/pdf' : 'text/csv')
  )
    throw new Error('Invalid file type');
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_DOWNLOAD_BYTES)) throw new Error('Invalid file size');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_DOWNLOAD_BYTES) throw new Error('File too large');
      parts.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (length && !response.headers.get('content-encoding') && Number(length) !== size)
    throw new Error('Incomplete file');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  const text = new TextDecoder('utf-8', { fatal: format === 'csv' });
  if (format === 'pdf') {
    if (
      new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-' ||
      !new TextDecoder().decode(bytes.slice(-1024)).trimEnd().endsWith('%%EOF')
    )
      throw new Error('Invalid PDF');
  } else {
    const content = text.decode(bytes);
    if (
      !(
        content.startsWith('"Field","Value","Unit"\r\n') ||
        (type === 'bookings' && content.startsWith('"Date","Bookings"\r\n'))
      ) ||
      !content.endsWith('\r\n')
    )
      throw new Error('Invalid CSV');
  }
  return bytes;
}
export const exportError = (status: number) =>
  ({
    400: 'Check the report filters.',
    401: 'Your session ended. Please sign in again.',
    403: 'Manager access is required.',
    422: 'This report is too large. Narrow the filters and retry.',
    503: 'The export service is unavailable. Retry shortly.'
  })[status] ?? 'The report could not be downloaded. Please retry.';
