import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WorkerPerformanceQueryDto } from './worker-performance-query.dto';
import { WorkerPerformanceService } from './worker-performance.service';

@Controller('mad/analytics')
@UseGuards(JwtAuthGuard)
export class WorkerPerformanceController {
  constructor(private readonly workers: WorkerPerformanceService) {}

  @Get('worker-performance')
  summary(@Query() query: WorkerPerformanceQueryDto) {
    return this.workers.summary(query);
  }
}
