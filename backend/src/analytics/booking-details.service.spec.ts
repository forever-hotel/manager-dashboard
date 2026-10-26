import { DataSource } from 'typeorm';
import { BookingDetailsService, BOOKING_DETAILS_SQL } from './booking-details.service';
import { ServiceUnavailableException } from '@nestjs/common';
describe('Booking details reporting', () => {
  const start = '2026-09-30T18:30:00.000Z',
    end = '2026-10-31T18:30:00.000Z';
  it('returns SQL-calculated stay length and booking rows using bound hotel-local dates', async () => {
    const query = jest.fn().mockResolvedValue([{ average_nights: 2.5, recent_bookings: [], total_bookings: '0' }]);
    const result = await new BookingDetailsService({ query } as unknown as DataSource).details(start, end);
    expect(result).toEqual({
      averageLengthOfStay: 2.5,
      recentBookings: [],
      bookingList: { total: 0, page: 1, pageSize: 5 }
    });
    expect(query).toHaveBeenCalledWith(BOOKING_DETAILS_SQL, [
      start,
      end,
      'Asia/Colombo',
      ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'],
      5,
      0
    ]);
  });
  it('keeps no-stay averages null rather than inventing a zero-night stay', async () => {
    const query = jest.fn().mockResolvedValue([{ average_nights: null, recent_bookings: [], total_bookings: '0' }]);
    expect(
      (await new BookingDetailsService({ query } as unknown as DataSource).details(start, end)).averageLengthOfStay
    ).toBeNull();
  });
  it.each([
    { rows: [] },
    { rows: [{ average_nights: -1, recent_bookings: [], total_bookings: '0' }] },
    { rows: [{ average_nights: 2, recent_bookings: null, total_bookings: '0' }] }
  ])('rejects invalid aggregates', async ({ rows }) => {
    const service = new BookingDetailsService({ query: jest.fn().mockResolvedValue(rows) } as unknown as DataSource);
    await expect(service.details(start, end)).rejects.toThrow(ServiceUnavailableException);
  });
  it('sanitizes database errors', async () => {
    const service = new BookingDetailsService({
      query: jest.fn().mockRejectedValue(new Error('private'))
    } as unknown as DataSource);
    await expect(service.details(start, end)).rejects.toThrow(ServiceUnavailableException);
  });
});
