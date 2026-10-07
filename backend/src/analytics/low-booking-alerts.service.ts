import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BOOKING_CLOCK, BOOKING_TIMEZONE } from './booking-analytics.service';
import { OccupancyAnalyticsService } from './occupancy-analytics.service';
import { lowBookingThreshold } from './low-booking-config';

@Injectable()
export class LowBookingAlertsService {
  private readonly threshold: number;
  constructor(
    private readonly occupancy: OccupancyAnalyticsService,
    config: ConfigService,
    @Inject(BOOKING_CLOCK) private readonly now: () => Date,
  ) {
    this.threshold = lowBookingThreshold(config.get<unknown>('LOW_BOOKING_THRESHOLD'));
  }

  async alerts() {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: BOOKING_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(this.now());
    const part = (type: string) => parts.find((item) => item.type === type)!.value;
    const from = `${part('year')}-${part('month')}-${part('day')}`;
    const to = new Date(Date.parse(from) + 13 * 86400000).toISOString().slice(0, 10);
    const calendar = await this.occupancy.calendar({ from, to });
    return {
      from, to, timezone: BOOKING_TIMEZONE, rangeEndInclusive: true,
      threshold: this.threshold,
      denominator: calendar.denominator,
      includedStatuses: calendar.includedStatuses,
      alerts: calendar.dates.filter((day) => day.rate !== null && day.rate < this.threshold)
        .map((day) => ({ ...day, promotionSuggestion: 'Consider creating a targeted promotion for this date.' })),
      unavailableDates: calendar.dates.filter((day) => day.rate === null)
        .map((day) => ({ ...day, reason: 'ZERO_ELIGIBLE_ROOMS' as const })),
      freshness: calendar.freshness,
    };
  }
}
