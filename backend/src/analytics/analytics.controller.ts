import { BadRequestException, Inject, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LowBookingAlertsService } from './low-booking-alerts.service';
import { BookingDetailsService } from './booking-details.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RevenueAnalyticsService } from './revenue-analytics.service';
import { BOOKING_CLOCK, BookingAnalyticsService } from './booking-analytics.service';
import { BookingQueryDto } from './booking-query.dto';
import { OccupancyAnalyticsService } from './occupancy-analytics.service';
import { OccupancyQueryDto } from './occupancy-query.dto';

@Controller('mad/analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(
    private readonly bookings: BookingAnalyticsService,
    private readonly occupancy: OccupancyAnalyticsService,
    private readonly lowBooking: LowBookingAlertsService,
    private readonly revenue: RevenueAnalyticsService,
    @Inject(BOOKING_CLOCK) private readonly now: () => Date,
    private readonly details: BookingDetailsService
  ) {}

  @Get('revenue')
  revenueSummary(@Query() query: BookingQueryDto) {
    return this.revenue.summary(query.period);
  }

  @Get('overview')
  async overview(@Query() query: BookingQueryDto) {
    const asOf = this.now().toISOString();
    const [bookings, revenue] = await Promise.all([
      this.bookings.summary(query.period, asOf),
      this.revenue.summary(query.period, asOf)
    ]);
    const localDate = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Colombo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date(iso));
    const [details, calendar] = await Promise.all([
      this.details.details(bookings.start, bookings.end),
      this.occupancy.calendar({
        from: localDate(bookings.start),
        to: localDate(new Date(Date.parse(bookings.end) - 86400000).toISOString())
      })
    ]);
    const occupiedRoomNights = calendar.dates.reduce((sum, day) => sum + day.occupiedRooms, 0);
    const eligibleRoomNights = calendar.dates.reduce((sum, day) => sum + day.eligibleRooms, 0);
    return {
      bookings,
      revenue,
      ...details,
      occupancy: {
        rate: eligibleRoomNights ? occupiedRoomNights / eligibleRoomNights : null,
        occupiedRoomNights,
        eligibleRoomNights,
        roomsUsingCreationDate: calendar.roomsUsingCreationDate
      }
    };
  }

  @Get('bookings')
  bookingsSummary(@Query() query: BookingQueryDto) {
    return this.bookings.summary(query.period);
  }

  @Get('occupancy')
  occupancyCalendar(@Query() query: OccupancyQueryDto) {
    return this.occupancy.calendar(query);
  }

  @Get('low-booking-alerts')
  lowBookingAlerts(@Query() query: Record<string, unknown>) {
    if (Object.keys(query).length) throw new BadRequestException('This endpoint does not accept query parameters.');
    return this.lowBooking.alerts();
  }
}
