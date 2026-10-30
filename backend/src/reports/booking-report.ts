import PDFDocument from 'pdfkit';
import { UnprocessableEntityException } from '@nestjs/common';
import type { BookingAnalyticsService } from '../analytics/booking-analytics.service';
import type { BookingDetailsService } from '../analytics/booking-details.service';
import { csvCell, MAX_REPORT_BYTES } from './report-renderer';

export type BookingReport = Awaited<ReturnType<BookingAnalyticsService['summary']>> &
  Awaited<ReturnType<BookingDetailsService['details']>>;
const navy = '#1A3C5E',
  gold = '#C9920D',
  border = '#DDD8CF',
  ink = '#1A1A18',
  muted = '#5A5650';
const human = (text: string) =>
  text
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
const date = (text: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(new Date(text.length === 10 ? text + 'T12:00:00Z' : text));
const amount = (minor: number) =>
  new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);

export function bookingTrendCsv(data: BookingReport) {
  const rows = [['Date', 'Bookings'], ...data.trend.map(row => [row.date, String(row.count)])];

  return Buffer.from('\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', 'utf8');
}

export function bookingReportPdf(data: BookingReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 32, bottom: 45, left: 32, right: 32 },
      bufferPages: true,
      info: { Title: 'Forever Hotel | Booking report', Author: 'Forever Hotel' }
    });
    const chunks: Buffer[] = [];
    let bytes = 0;

    doc.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_REPORT_BYTES) {
        doc.destroy();
        reject(new UnprocessableEntityException('Report exceeds download size. Select a shorter period.'));
      } else chunks.push(chunk);
    });
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      doc.registerFont('Body', require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'));
      doc.registerFont(
        'Sinhala',
        require.resolve('@fontsource/noto-sans-sinhala/files/noto-sans-sinhala-sinhala-400-normal.woff')
      );
      doc.registerFont(
        'Tamil',
        require.resolve('@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-400-normal.woff')
      );
      const font = (value: string) =>
        /[\u0d80-\u0dff]/.test(value) ? 'Sinhala' : /[\u0b80-\u0bff]/.test(value) ? 'Tamil' : 'Body';
      function text(value: string, x: number, y: number, width: number, size = 9, color = ink) {
        const runs: { font: string; text: string }[] = [];

        for (const char of value) {
          const chosen = /[\u200c\u200d]/.test(char) ? (runs.at(-1)?.font ?? 'Body') : font(char);
          const previous = runs.at(-1);

          if (previous?.font === chosen) previous.text += char;
          else runs.push({ font: chosen, text: char });
        }
        doc.x = x;
        doc.y = y;
        runs.forEach((run, i) =>
          doc
            .font(run.font)
            .fontSize(size)
            .fillColor(color)
            .text(run.text, { width, continued: i < runs.length - 1 })
        );
      }
      const width = doc.page.width - 64;
      const lastDate = new Date(Date.parse(data.end) - 86400000).toISOString();
      const period = date(data.start) + ' - ' + date(lastDate);
      function heading() {
        doc.rect(0, 0, doc.page.width, 66).fill(navy);
        doc.rect(32, 66, width, 3).fill(gold);
        text('FOREVER HOTEL', 32, 16, width, 10, '#FFFFFF');
        text('Booking report', 32, 32, width, 21, '#FFFFFF');
        text(human(data.period) + ' | ' + period, 32, 81, width, 10, navy);
      }
      heading();
      const cardWidth = (width - 24) / 3;
      const cards = [
        ['Eligible bookings', String(data.total)],
        ['Booking records (all statuses)', String(data.bookingList.total)],
        [
          'Average length of stay',
          data.averageLengthOfStay === null ? 'No eligible stays' : data.averageLengthOfStay.toFixed(1) + ' nights'
        ]
      ];

      cards.forEach(([title, value], i) => {
        const x = 32 + i * (cardWidth + 12);

        doc.roundedRect(x, 107, cardWidth, 61, 6).lineWidth(0.6).fillAndStroke('#F5F3EF', border);
        text(title, x + 12, 118, cardWidth - 24, 8, muted);
        text(value, x + 12, 134, cardWidth - 24, 17, navy);
      });
      text('Booking register', 32, 184, width, 12, navy);
      const columns = [114, 132, 102, 70, 70, 92, 82, width - 662];
      const labels = ['Booking ID', 'Guest', 'Room type', 'Check-in', 'Check-out', 'Amount (LKR)', 'Source', 'Status'];
      function tableHeader(y: number) {
        doc.rect(32, y, width, 26).fill(navy);
        let x = 32;

        labels.forEach((label, i) => {
          text(label, x + 7, y + 8, columns[i] - 14, 7.5, '#FFFFFF');
          x += columns[i];
        });
        return y + 26;
      }
      let y = tableHeader(205);

      if (!data.recentBookings.length) {
        doc.rect(32, y, width, 52).fill('#F9F7F4');
        text('No bookings check in during the selected period.', 44, y + 18, width - 24, 10, muted);
      }
      data.recentBookings.forEach((booking, index) => {
        const cells = [
          booking.id,
          booking.guestName ?? 'Unregistered guest',
          booking.roomType,
          date(booking.checkIn),
          date(booking.checkOut),
          amount(booking.amountMinor),
          human(booking.source),
          human(booking.status)
        ];
        const height = Math.max(
          32,
          ...cells.map(
            (cell, i) =>
              doc
                .font(font(cell))
                .fontSize(7.5)
                .heightOfString(cell, { width: columns[i] - 14 }) + 10
          )
        );

        if (y + height > doc.page.height - 62) {
          doc.addPage();
          heading();
          y = tableHeader(107);
        }
        doc.rect(32, y, width, height).fill(index % 2 ? '#F9F7F4' : '#FFFFFF');
        let x = 32;

        cells.forEach((cell, i) => {
          const color =
            i === 7
              ? booking.status === 'CANCELLED'
                ? '#8B1A1A'
                : booking.status === 'CHECKED_IN'
                  ? '#1A6B3C'
                  : navy
              : ink;

          text(cell, x + 7, y + 8, columns[i] - 14, 7.5, color);
          x += columns[i];
        });
        doc
          .moveTo(32, y + height)
          .lineTo(32 + width, y + height)
          .strokeColor(border)
          .lineWidth(0.5)
          .stroke();
        y += height;
      });
      const range = doc.bufferedPageRange();

      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        const footer = doc.page.height - 44;

        doc
          .moveTo(32, footer - 7)
          .lineTo(32 + width, footer - 7)
          .strokeColor(border)
          .stroke();
        text(
          'Counts use confirmed, checked-in and checked-out check-ins. Booking amounts are LKR, not payment revenue.',
          32,
          footer,
          width - 85,
          7,
          muted
        );
        text('Asia/Colombo | Generated ' + date(data.asOf), 32, footer + 12, width - 85, 7, muted);
        doc
          .font('Body')
          .fontSize(7)
          .fillColor(muted)
          .text('Page ' + (i + 1) + ' of ' + range.count, doc.page.width - 100, footer, {
            width: 68,
            lineBreak: false,
            align: 'right'
          });
      }
      doc.end();
    } catch (error) {
      doc.destroy();
      reject(error instanceof Error ? error : new Error('Booking report failed'));
    }
  });
}
