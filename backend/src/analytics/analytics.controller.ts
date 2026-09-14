import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { BookingQueryDto } from './dto/booking-query.dto';
import { OccupancyQueryDto } from './dto/occupancy-query.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('mad/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * MAD-009 — GET /mad/analytics/bookings?period=day|week|month
   * Returns booking summary stats and per-day breakdown for the given period.
   */
  @Get('bookings')
  getBookingSummary(@Query() query: BookingQueryDto) {
    return this.analyticsService.getBookingSummary(query.period);
  }

  /**
   * MAD-010 — GET /mad/analytics/occupancy?from=YYYY-MM-DD&to=YYYY-MM-DD
   * Returns occupancy rate for each date in the specified range.
   */
  @Get('occupancy')
  getOccupancy(@Query() query: OccupancyQueryDto) {
    return this.analyticsService.getOccupancyData(query.from, query.to);
  }

  /**
   * MAD-011 — GET /mad/analytics/low-booking-alerts
   * Returns dates in the next 14 days where predicted occupancy < threshold.
   */
  @Get('low-booking-alerts')
  getLowBookingAlerts() {
    return this.analyticsService.getLowBookingAlerts();
  }
}
