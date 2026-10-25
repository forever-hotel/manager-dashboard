import { monthDates, type Occupancy } from '@/lib/occupancy';

export function occupancy(month = '2024-02'): Occupancy {
  const dates = monthDates(month);
  return {
    from: dates[0],
    to: dates[dates.length - 1],
    timezone: 'Asia/Colombo',
    rangeEndInclusive: true,
    maxRangeDays: 366,
    includedStatuses: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'],
    denominator: 'active_rooms_excluding_maintenance',
    dates: dates.map((date, index) => ({
      date,
      occupiedRooms: index % 4 === 3 ? 0 : [2, 4, 7][index % 4],
      eligibleRooms: index % 4 === 3 ? 0 : 10,
      rate: index % 4 === 3 ? null : [0.2, 0.4, 0.7][index % 4]
    })),
    freshness: {
      queriedAt: '2024-02-01T00:00:00Z',
      sourceLatestUpdatedAt: null
    }
  };
}
