import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { LowBookingAlertsService } from './low-booking-alerts.service';
import { OccupancyAnalyticsService } from './occupancy-analytics.service';
import { lowBookingThreshold } from './low-booking-config';
import { AnalyticsController } from './analytics.controller';
import { BookingAnalyticsService } from './booking-analytics.service';

describe('DDP-011 low-booking alerts', () => {
  const calendar = jest.fn();
  const occupancy = { calendar } as unknown as OccupancyAnalyticsService;
  const create = (threshold: unknown = '0.40', instant = '2026-12-31T18:30:00Z') =>
    new LowBookingAlertsService(occupancy, new ConfigService({ LOW_BOOKING_THRESHOLD: threshold }), () => new Date(instant));
  beforeEach(() => calendar.mockReset());

  it('AC1/AC2: includes only rates strictly below threshold and separates unknown rates', async () => {
    calendar.mockResolvedValue({ dates: [
      { date: '2027-01-01', rate: 0.2, eligibleRooms: 5, occupiedRooms: 1 },
      { date: '2027-01-02', rate: 0.4, eligibleRooms: 5, occupiedRooms: 2 },
      { date: '2027-01-03', rate: 0.8, eligibleRooms: 5, occupiedRooms: 4 },
      { date: '2027-01-04', rate: null, eligibleRooms: 0, occupiedRooms: 0 },
    ], freshness: { queriedAt: 'fixed' }, denominator: 'active_rooms_excluding_maintenance', includedStatuses: ['CONFIRMED'] });
    const result = await create().alerts();
    expect(calendar).toHaveBeenCalledTimes(1);
    expect(calendar).toHaveBeenCalledWith({ from: '2027-01-01', to: '2027-01-14' });
    expect(result.alerts).toEqual([expect.objectContaining({ date: '2027-01-01', rate: 0.2, promotionSuggestion: expect.any(String) })]);
    expect(result.unavailableDates).toEqual([expect.objectContaining({ date: '2027-01-04', rate: null, reason: 'ZERO_ELIGIBLE_ROOMS' })]);
    expect(result.freshness).toEqual({ queriedAt: 'fixed' });
  });
  it.each([
    ['2026-12-31T18:29:59Z', '2026-12-31', '2027-01-13'],
    ['2028-02-28T20:00:00Z', '2028-02-29', '2028-03-13'],
  ])('uses hotel calendar boundaries at %s', async (instant, from, to) => {
    calendar.mockResolvedValue({ dates: [], freshness: {} });
    await create('0.4', instant).alerts();
    expect(calendar).toHaveBeenCalledWith({ from, to });
  });
  it('AC3: returns an empty alert list when threshold is zero', async () => {
    calendar.mockResolvedValue({ dates: [{ date: '2027-01-01', rate: 0 }], freshness: {} });
    expect((await create('0').alerts()).alerts).toEqual([]);
  });
  it('fails closed when occupancy is unavailable', async () => {
    calendar.mockRejectedValue(new ServiceUnavailableException());
    await expect(create().alerts()).rejects.toThrow(ServiceUnavailableException);
  });
  it('rejects client overrides and accepts no query parameters', async () => {
    const alerts = jest.fn().mockResolvedValue({ alerts: [] });
    const controller = new AnalyticsController({} as BookingAnalyticsService, occupancy, { alerts } as unknown as LowBookingAlertsService);
    expect(() => controller.lowBookingAlerts({ threshold: '0.9' })).toThrow();
    expect(alerts).not.toHaveBeenCalled();
    await expect(controller.lowBookingAlerts({})).resolves.toEqual({ alerts: [] });
  });
  it.each(['', ' ', '-0.1', '1.1', 'NaN', 'Infinity', '40%', true, null, {}, Infinity, NaN, -1, 2])(
    'AC3: rejects invalid configured threshold %p', (value) => {
      expect(() => lowBookingThreshold(value)).toThrow('LOW_BOOKING_THRESHOLD');
    },
  );
  it.each([['0', 0], ['0.40', 0.4], ['1.00', 1], [0.25, 0.25], [undefined, 0.4]])(
    'accepts threshold %p', (value, expected) => expect(lowBookingThreshold(value)).toBe(expected),
  );
});
