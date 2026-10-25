import type { LowDemand } from '@/lib/low-demand';
export const lowDemand = (): LowDemand => ({
  from: '2028-02-20',
  to: '2028-03-04',
  timezone: 'Asia/Colombo',
  rangeEndInclusive: true,
  threshold: 0.4,
  denominator: 'active_rooms_excluding_maintenance',
  includedStatuses: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'],
  alerts: [
    {
      date: '2028-02-29',
      occupiedRooms: 1,
      eligibleRooms: 5,
      rate: 0.2,
      promotionSuggestion: 'Consider a promotion.'
    }
  ],
  unavailableDates: [],
  freshness: {
    queriedAt: '2028-02-20T00:00:00.000Z',
    sourceLatestUpdatedAt: null
  }
});
