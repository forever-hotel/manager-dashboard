import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnalyticsController } from './analytics.controller';
import {
  BOOKING_CLOCK,
  BookingAnalyticsService,
} from './booking-analytics.service';

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [
    BookingAnalyticsService,
    { provide: BOOKING_CLOCK, useValue: () => new Date() },
  ],
})
export class AnalyticsModule {}
