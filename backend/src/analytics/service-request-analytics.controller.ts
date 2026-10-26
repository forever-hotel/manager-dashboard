import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BookingQueryDto } from './booking-query.dto';
import { ServiceRequestAnalyticsService } from './service-request-analytics.service';
import { ServiceRequestListQueryDto } from './service-request-query.dto';
@Controller('mad/analytics')
@UseGuards(JwtAuthGuard)
export class ServiceRequestAnalyticsController {
  constructor(private readonly requests: ServiceRequestAnalyticsService) {}
  @Get('service-requests') summary(@Query() query: BookingQueryDto) {
    return this.requests.summary(query.period, query.date);
  }
  @Get('service-requests/list') list(@Query() query: ServiceRequestListQueryDto) {
    return this.requests.list(query);
  }
}
