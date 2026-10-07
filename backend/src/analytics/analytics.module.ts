import { Module } from '@nestjs/common';
import { LowBookingAlertsService } from './low-booking-alerts.service';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import { OccupancyAnalyticsService } from './occupancy-analytics.service';
import {
  BOOKING_CLOCK,
  BookingAnalyticsService,
} from './booking-analytics.service';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [
    LowBookingAlertsService,
    BookingAnalyticsService,
    OccupancyAnalyticsService,
    { provide: BOOKING_CLOCK, useValue: () => new Date() },
  ],
})
export class AnalyticsModule {}
