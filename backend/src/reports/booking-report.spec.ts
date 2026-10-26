import { bookingReportPdf, bookingTrendCsv, type BookingReport } from './booking-report';
const data = {
  period: 'week',
  timezone: 'Asia/Colombo',
  weekStartsOn: 'monday',
  metric: 'bookings_checking_in',
  includedStatuses: ['CONFIRMED'],
  start: '2026-10-25T18:30:00Z',
  end: '2026-11-01T18:30:00Z',
  asOf: '2026-10-26T12:00:00Z',
  bucketSize: 'day',
  total: 1,
  trend: [{ date: '2026-10-26', start: '2026-10-25T18:30:00Z', end: '2026-10-26T18:30:00Z', count: 1 }],
  freshness: { queriedAt: '2026-10-26T12:00:00Z', sourceLatestUpdatedAt: null },
  averageLengthOfStay: 2,
  bookingList: { total: 1, page: 1, pageSize: 500 },
  recentBookings: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      guestName: 'A. Perera',
      roomType: 'Deluxe',
      checkIn: '2026-10-26',
      checkOut: '2026-10-28',
      amountMinor: 4200000,
      source: 'WEBSITE',
      status: 'CONFIRMED'
    }
  ]
} as BookingReport;
describe('Presentation booking exports', () => {
  it('exports the chart as readable dates and counts rather than internal field paths', () => {
    expect(bookingTrendCsv(data).toString()).toBe('\ufeff"Date","Bookings"\r\n"2026-10-26","1"\r\n');
  });
  it('creates a branded printable PDF containing the entire booking selection', async () => {
    const pdf = await bookingReportPdf({
      ...data,
      recentBookings: Array.from({ length: 35 }, (_, i) => ({
        ...data.recentBookings[0],
        guestName: 'Guest ' + i,
        status: i % 2 ? 'CANCELLED' : 'CHECKED_IN'
      })),
      bookingList: { total: 35, page: 1, pageSize: 500 }
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-20).toString()).toContain('%%EOF');
    expect(pdf.toString('latin1')).toContain('Forever Hotel | Booking report');
    expect(pdf.toString('latin1')).toMatch(/\/Count [2-9]/);
  });
  it('renders an empty selection without inventing stay averages', async () => {
    const pdf = await bookingReportPdf({
      ...data,
      total: 0,
      recentBookings: [],
      averageLengthOfStay: null,
      bookingList: { total: 0, page: 1, pageSize: 500 }
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
