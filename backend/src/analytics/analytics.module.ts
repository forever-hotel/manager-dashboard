import { RevenueAnalyticsService } from './revenue-analytics.service';
import { Module } from '@nestjs/common';
import { LowBookingAlertsService } from './low-booking-alerts.service';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import { OccupancyAnalyticsService } from './occupancy-analytics.service';
import { FoodAnalyticsService } from './food-analytics.service';
import { FoodAnalyticsController } from './food-analytics.controller';
import {
  BOOKING_CLOCK,
  BookingAnalyticsService,
} from './booking-analytics.service';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController, FoodAnalyticsController],
  providers: [
    FoodAnalyticsService,
    LowBookingAlertsService,
    RevenueAnalyticsService,
    BookingAnalyticsService,
    OccupancyAnalyticsService,
    { provide: BOOKING_CLOCK, useValue: () => new Date() },
  ],
})
export class AnalyticsModule {}
