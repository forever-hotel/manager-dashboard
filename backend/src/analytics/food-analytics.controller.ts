import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BookingQueryDto } from './booking-query.dto';
import { FoodAnalyticsService } from './food-analytics.service';

@Controller('mad/analytics')
@UseGuards(JwtAuthGuard)
export class FoodAnalyticsController {
  constructor(private readonly food: FoodAnalyticsService) {}
  @Get('food-orders') summary(@Query() query: BookingQueryDto) {
    return this.food.summary(query.period, query.date);
  }
}
