import { AnalyticsController } from './analytics.controller';
describe('Analytics overview metrics', () => {
  const calendar = jest.fn();
  const details = jest.fn();
  const start = '2026-09-30T18:30:00.000Z',
    end = '2026-10-31T18:30:00.000Z';
  const make = () =>
    new AnalyticsController(
      ...([
        { summary: jest.fn().mockResolvedValue({ start, end, total: 2 }) },
        { calendar },
        {},
        { summary: jest.fn().mockResolvedValue({ currentMinor: 100 }) },
        () => new Date('2026-10-26T12:00:00Z'),
        { details }
      ] as unknown as ConstructorParameters<typeof AnalyticsController>)
    );
  beforeEach(() => {
    jest.clearAllMocks();
    details.mockResolvedValue({ averageLengthOfStay: 2.5, recentBookings: [] });
  });
  it('weights occupancy by eligible room nights and uses exclusive period end correctly', async () => {
    calendar.mockResolvedValue({
      dates: [
        { occupiedRooms: 1, eligibleRooms: 2 },
        { occupiedRooms: 8, eligibleRooms: 10 }
      ],
      roomsUsingCreationDate: 2
    });
    const result = await make().overview({ period: 'month' });
    expect(result.occupancy).toEqual({
      rate: 0.75,
      occupiedRoomNights: 9,
      eligibleRoomNights: 12,
      roomsUsingCreationDate: 2
    });
    expect(result.averageLengthOfStay).toBe(2.5);
    expect(calendar).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-31' });
    expect(details).toHaveBeenCalledWith(start, end, 1, 5);
  });
  it('keeps zero capacity unknown rather than claiming zero-percent occupancy', async () => {
    calendar.mockResolvedValue({ dates: [{ occupiedRooms: 0, eligibleRooms: 0 }], roomsUsingCreationDate: 0 });
    expect((await make().overview({ period: 'month' })).occupancy.rate).toBeNull();
  });
});
