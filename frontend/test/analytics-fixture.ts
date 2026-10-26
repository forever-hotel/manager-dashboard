import type { Overview, Period } from '@/lib/analytics';
export function overview(period: Period = 'week', total = 4): Overview {
  return {
    averageLengthOfStay: total ? 2.4 : null,
    occupancy: { rate: 0.5, occupiedRoomNights: 14, eligibleRoomNights: 28, roomsUsingCreationDate: 0 },
    recentBookings: [],
    bookings: {
      period,
      timezone: 'Asia/Colombo',
      start: '2026-10-11T18:30:00.000Z',
      end: '2026-10-18T18:30:00.000Z',
      asOf: '2026-10-15T00:00:00.000Z',
      total,
      trend: [
        {
          date: '2026-10-12',
          start: '2026-10-11T18:30:00.000Z',
          end: '2026-10-12T18:30:00.000Z',
          count: total
        }
      ]
    },
    revenue: {
      period,
      timezone: 'Asia/Colombo',
      currency: 'LKR',
      metric: 'completed_payment_revenue',
      comparison: 'whole_calendar_period',
      start: '2026-10-11T18:30:00.000Z',
      end: '2026-10-18T18:30:00.000Z',
      asOf: '2026-10-15T00:00:00.000Z',
      previousStart: '2026-10-04T18:30:00.000Z',
      previousEnd: '2026-10-11T18:30:00.000Z',
      currentMinor: 20001,
      previousMinor: 10000,
      percentageChange: 100.01,
      percentageUnavailableReason: null
    }
  };
}
