import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { KitchenQueryDto } from './kitchen-query.dto';
import { KitchenService } from './kitchen.service';

@Controller('mad/kitchen')
@UseGuards(JwtAuthGuard)
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get('orders')
  orders(@Query() query: KitchenQueryDto) {
    return this.kitchen.snapshot(query);
  }
}
