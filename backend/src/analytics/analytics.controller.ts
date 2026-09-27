import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BookingAnalyticsService } from './booking-analytics.service';
import { BookingQueryDto } from './booking-query.dto';

@Controller('mad/analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly bookings: BookingAnalyticsService) {}

  @Get('bookings')
  bookingsSummary(@Query() query: BookingQueryDto) {
    return this.bookings.summary(query.period);
  }
}
