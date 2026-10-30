import { Controller, Get, Query, UseGuards, All, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TasksQueryDto } from './tasks-query.dto';
import { TasksService } from './tasks.service';

@Controller('mad/tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @All([':id/claim', ':id/assign', ':id/complete'])
  denyMutation() {
    throw new ForbiddenException();
  }

  @Get()
  list(@Query() query: TasksQueryDto) {
    return this.tasks.snapshot(query);
  }
}
