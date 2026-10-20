import { UnprocessableEntityException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
export const MAX_REPORT_ROWS = 10000;
export const MAX_REPORT_BYTES = 8 * 1024 * 1024;
export type ReportRow = [string, string, string];
const tooLarge = () =>
  new UnprocessableEntityException(
    'Report exceeds export limits. Narrow the filters.',
  );
function units(path: string, value: unknown) {
  if (value === null) return 'unavailable';
  if (/Minor$/.test(path)) return 'LKR cents';
  if (/percentageChange$/.test(path)) return 'percent';
  if (/(rate|threshold)$/.test(path)) return 'ratio (0-1)';
  if (/(Minutes|averageMinutes)$/.test(path)) return 'minutes';
  if (typeof value === 'number')
    return /(Count|count|total|quantity|Rooms)$/.test(path)
      ? 'count'
      : 'number';
  return '';
}
// Lossless field paths retain cohorts, totals, trend buckets, filters and quality metadata.
export function flattenReport(data: Record<string, unknown>): ReportRow[] {
  const rows: ReportRow[] = [];
  function visit(value: unknown, path: string, depth: number) {
    if (depth > 12 || rows.length >= MAX_REPORT_ROWS) throw tooLarge();
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value);
      if (!entries.length) {
        rows.push([path, Array.isArray(value) ? '[]' : '{}', 'empty']);
        return;
      }
      for (const [key, child] of entries)
        visit(
          child,
          Array.isArray(value)
            ? `${path}[${key}]`
            : path
              ? `${path}.${key}`
              : key,
          depth + 1,
        );
    } else {
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      )
        throw new Error('Invalid report value');
      const text = value === null ? 'null' : String(value);
      if (Buffer.byteLength(text) > 2048 || path.length > 256) throw tooLarge();
      rows.push([path, text, units(path, value)]);
    }
  }
  visit(data, '', 0);
  return rows;
}
export function csvCell(value: string) {
  // Quote every cell. A leading apostrophe neutralizes formulas even after whitespace/control prefixes.
  let start = 0;
  while (
    start < value.length &&
    (value[start].trim() === '' ||
      value.charCodeAt(start) < 32 ||
      value.charCodeAt(start) === 127)
  )
    start++;
  const safe =
    ['=', '+', '@', '-'].includes(value[start]) || /^[\t\r\n]/.test(value)
      ? "'" + value
      : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function renderCsv(rows: ReportRow[]) {
  const result = Buffer.from(
    '\ufeff' +
      [['Field', 'Value', 'Unit'], ...rows]
        .map((row) => row.map(csvCell).join(','))
        .join('\r\n') +
      '\r\n',
    'utf8',
  );
  if (result.length > MAX_REPORT_BYTES) throw tooLarge();
  return result;
}
export function renderPdf(
  title: string,
  period: string,
  rows: ReportRow[],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 45, bottom: 50, left: 40, right: 40 },
      bufferPages: true,
      info: { Title: title, Author: 'Forever Hotel' },
    });
    const chunks: Buffer[] = [];
    let bytes = 0,
      pages = 1;
    doc.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_REPORT_BYTES) {
        doc.destroy();
        reject(tooLarge());
      } else chunks.push(chunk);
    });
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      doc.registerFont(
        'Latin',
        require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'),
      );
      doc.registerFont(
        'Sinhala',
        require.resolve('@fontsource/noto-sans-sinhala/files/noto-sans-sinhala-sinhala-400-normal.woff'),
      );
      doc.registerFont(
        'Tamil',
        require.resolve('@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-400-normal.woff'),
      );
      doc.on('pageAdded', () => {
        pages++;
        if (pages > 120) throw tooLarge();
      });
      function text(value: string, size = 9) {
        // Keep complete script runs for shaping. Unsupported scripts are visibly escaped, never silently dropped.
        const runs: { font: string; text: string }[] = [];
        for (const char of value) {
          const code = char.codePointAt(0)!;
          const font =
            code === 0x200c || code === 0x200d
              ? (runs.at(-1)?.font ?? 'Latin')
              : code >= 0x0d80 && code <= 0x0dff
                ? 'Sinhala'
                : code >= 0x0b80 && code <= 0x0bff
                  ? 'Tamil'
                  : 'Latin';
          const printable =
            font !== 'Latin' ||
            code <= 255 ||
            '\u2013\u2014\u2018\u2019\u201c\u201d'.includes(char)
              ? char
              : `[U+${code.toString(16).toUpperCase()}]`;
          const last = runs.at(-1);
          if (last?.font === font) last.text += printable;
          else runs.push({ font, text: printable });
        }
        runs.forEach((run, index) =>
          doc
            .font(run.font)
            .fontSize(size)
            .text(run.text, { continued: index < runs.length - 1 }),
        );
      }
      text(title, 16);
      text('Period: ' + period);
      text('Timezone: Asia/Colombo');
      text(
        'Units: counts; LKR cents for revenue; minutes for duration; ratios 0-1; percent for changes.',
      );
      text(
        'Fields and values match the analytics snapshot. null means unavailable; [] means no rows.',
      );
      doc.moveDown();
      for (const [field, value, unit] of rows) {
        text(`${field}: ${value}${unit ? ' (' + unit + ')' : ''}`);
      }
      const range = doc.bufferedPageRange();
      for (let index = 0; index < range.count; index++) {
        doc.switchToPage(index);
        doc
          .font('Latin')
          .fontSize(8)
          .text(
            `Page ${index + 1} of ${range.count}`,
            40,
            doc.page.height - 35,
            { lineBreak: false },
          );
      }
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(
        error instanceof Error ? error : new Error('PDF generation failed'),
      );
    }
  });
}
